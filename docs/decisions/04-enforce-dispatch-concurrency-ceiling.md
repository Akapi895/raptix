# 4. Áp đặt trần concurrency thật cho dispatch

## Bối cảnh

ADR-0021 (gate cách ly session B0), ADR-0023 (mở rộng surface lặp có
giới hạn), và ADR-0026 (fan-out surface song song có giới hạn,
`max_in_flight=3`) cộng lại biện minh cho 1 trần dispatch đồng thời
rộng 3. Cả 3 đều đặt nền hoàn toàn trên cách ly phía orchestrator:
session tmux riêng, thư mục workspace riêng, chứng minh 2 coroutine có
thể ghi vào 2 đường dẫn `/workspace/se/b0-*` riêng mà không đụng nhau.
Không cái nào xem xét phía target — liệu thứ đang bị probe có tự chịu
được tải đồng thời hay không.

`DispatchMiddleware._prepare` (`packages/raptix/raptix/middleware/dispatch.py`)
phản ánh đúng lỗ hổng này. Tập `_active` của nó chỉ từ chối 1 dispatch
có key `(scope, dispatch_id)` đã đang chạy — nó chặn việc bắn lại đúng
1 dispatch giống nhau, nhưng không đếm có bao nhiêu dispatch *khác
nhau* đang chia sẻ 1 scope. "Tối đa 3 lúc 1 lần" trong prompt
orchestrator chỉ là quy ước ở mức prompt
(`intelligence/prompts/standard/raptix.md`); không có gì trong code
thực thi điều đó. 1 engagement thật đã tạo ra đúng kiểu lỗi này dự báo:
1 payload bị tiêm vào không có timeout phía client đã chặn vĩnh viễn
worker duy nhất của 1 service chỉ có 1 worker, làm kẹt cứng nó —
mọi request sau đó, gồm cả lần thử phục hồi và bất kỳ dispatch anh em
nào đang probe cùng host, đều xếp hàng sau đúng chỗ nghẽn đó (ghi lại ở
`docs/design/2026-10-12-p4-system-optimization-research.md`, phát
hiện "self-DoS wedge", và ở
`docs/proposals/2026-10-14-auto-fanout-dispatch-mechanism.md`).

Việc này càng quan trọng khi fan-out được dùng nhiều hơn: điều kiện
kích hoạt coverage-matrix của web đang được làm đáng tin cậy hơn (xem
đề xuất fan-out trên), việc đó càng tăng tần suất nhiều dispatch đồng
thời thực sự được phát ra trong thực tế. Áp trần ngay bây giờ, tại
đúng 1 điểm nghẽn dispatch thật mà mọi role đều đi qua, đóng lỗ hổng
trước khi nó bị khai thác nhiều hơn.

## Quyết định

Thêm 1 bộ đếm admission theo scope trong `DispatchMiddleware`, cạnh
tập `_active` hiện có. Trần mặc định là 3, khớp số ADR-0026 đã giả
định; override bằng `RAPTIX_MAX_CONCURRENT_DISPATCHES`, theo đúng mẫu
resolver mà `DISPATCH_TIMEOUT_ENV`/`_resolve_dispatch_timeout_seconds`
đã thiết lập trong cùng module.

Trong `_prepare`, sau khi kiểm tra dispatch-trùng hiện có và trước khi
admit 1 dispatch mới, đếm số entry active có scope khớp với dispatch
mới. Nếu số đó đã chạm trần, từ chối với lỗi mới
`dispatch_capacity_exceeded` — cùng hình dạng với reply
`dispatch_in_flight`/`dispatch_conflict` hiện có, để model thấy 1 tín
hiệu rõ ràng, có thể hành động, thay vì để số dispatch không giới hạn
âm thầm chạy tiếp hoặc deadlock trên 1 target chung.

Bộ đếm được scope theo `(engagement/thread)`, không toàn cục — 1
engagement chạm trần không bao giờ được chặn 1 engagement khác, không
liên quan, đang chạy đồng thời.

## Hệ quả

Không có kỹ thuật tấn công, tool, hay role nào bị hạn chế bởi thay đổi
này — nó chỉ giới hạn số dispatch *đồng thời* mà 1 engagement có thể
chạy cùng lúc, điều mà hệ thống đã giả định là giới hạn ở 3 nhưng chưa
bao giờ xác minh. Hiệu ứng thực tế là chuyển 1 khả năng chồng chất vô
hạn lên 1 target dễ vỡ thành 1 từ chối rõ ràng, có giới hạn mà
orchestrator có thể phản ứng lại (chờ, hoặc thử lại tuần tự). Đây là
lưới an toàn chống tự làm mất foothold, không phải cắt giảm năng lực.

ADR này không thêm nhận biết theo target (ví dụ phát hiện 1 service cụ
thể chỉ có 1 worker nên cần trần thấp hơn nữa) — việc đó xử lý riêng,
như 1 tín hiệu tùy cơ ở Phase 1 của
`docs/proposals/2026-10-14-auto-fanout-dispatch-mechanism.md`, vẫn
không thể vượt trần mà ADR này áp đặt.

## Phương án đã xem xét và loại bỏ

- Đẩy enforcement `max_in_flight` vào prompt orchestrator mạnh hơn
  (dùng từ ngữ tốt hơn, chỉ thị mạnh hơn): loại — 1 chỉ thị sinh ra
  (generative) không phải là 1 bảo đảm, và incident thật mà cơ chế này
  phòng chống đã xảy ra ngay dưới cách diễn đạt prompt hiện có.
- Thực thi trần qua semaphore `max_concurrent_connections` sẵn có của
  `RoEGuardrailMiddleware` thay vì bộ đếm mới: loại — semaphore đó là
  trần toàn cục, theo từng engagement cho tool call network/bash trên
  *toàn bộ* công việc đồng thời, không scope theo các dispatch anh em
  của cùng 1 batch fan-out; dùng chung sẽ trộn lẫn 2 việc khác nhau
  (giới hạn tốc độ request thô so với giới hạn số lượng dispatch) và
  làm cả 2 khó suy luận hoặc tune độc lập hơn.
