# 5. Admission fan-out tổng quát, nhận biết an toàn, từ work unit có chú giải

## Bối cảnh

Admission dispatch hiện tại (ADR-0067) bị "mù": `DispatchMiddleware._prepare`
chỉ đếm slot đồng thời theo engagement, không gì khác. Việc 1 dispatch
ứng viên có đồng thời thay đổi cùng 1 tài khoản/thư mục với 1 dispatch
đang chạy, hay có probe 1 service chỉ 1 worker mà 1 dispatch anh em đã
làm kẹt, đều vô hình với cổng này. Prompt orchestrator bù đắp 1 phần
bằng các chỉ dẫn fan-out riêng cho web/scoreboard (coverage matrix,
challenge sweep), nhưng không tổng quát hóa được: không có gì trong
runtime ngăn 1 fan-out Active Directory hay network lặp lại đúng
incident lockout/kẹt do concurrency đã quan sát được ở production.

Vì vậy cần tách và nối lại 2 sự thật:

1. **Cái gì an toàn để chạy đồng thời là kiến thức domain** —
   kerberoast 1 account, NTLM relay, DCSync, scan đồng thời thiết bị
   embedded, mỗi thứ mang bán kính ảnh hưởng và độ ồn khác nhau.
   Hardcode bất kỳ cái này vào scheduler sẽ tạo đường code riêng theo
   từng domain và không tổng quát hóa được.
2. **Quyết định admission phải là code xác định** — 1 LLM được giao
   tự điều tiết concurrency dưới tải sẽ bỏ qua đúng quy tắc vào đúng
   lúc quy tắc đó quan trọng nhất (chính là tiền đề của ADR-0067).

## Quyết định

Thêm 1 cổng admission tổng quát duy nhất, dẫn động bằng chú giải khai
báo mà bên sinh ra work unit tự kiểm soát:

1. **Hợp đồng work-unit trên `Objective`** (raptix-core): `effects`
   (`read`/`mutate`/`destructive`), `resources` (định danh chia sẻ-có
   thể-đổi cụ thể, ví dụ `account:svc`, `host:10.0.0.5`,
   `surface:/api/Users`), và `parallel_safe` (`true`/`false`/chưa đặt).
   Tất cả tùy chọn; `effects` chưa đặt mặc định là `mutate` và
   `parallel_safe` chưa đặt coi là `False` cho việc mutate — **không
   rõ nghĩa là thận trọng**.
2. **Module chính sách thuần** `raptix.middleware.fanout_admission`:
   với 1 work unit ứng viên, các unit đang chạy, trần (toàn cục, theo
   target, theo tier OPSEC của engagement, giới hạn destructive), và 1
   bản đồ khả năng chịu tải, module trả về admit/reject kèm mã máy đọc
   được (`resource_conflict`, `effect_conflict`, `opsec_conflict`,
   `fragile_cap`, `capacity_exceeded`) và id của các unit chặn. Không
   I/O, không tên domain nào — module được unit-test đảm bảo không
   chứa những thứ đó.
3. **Nối vào `DispatchMiddleware._prepare`**: nhánh capacity "mù"
   được thay (sau cờ `RAPTIX_FANOUT_ADMISSION`, mặc định tắt = hành vi
   hôm nay giữ nguyên byte-for-byte) bằng lời gọi chính sách. Từ chối
   dùng lại mã `_reply` có cấu trúc sẵn có để orchestrator thích ứng
   được, và mọi quyết định được phát ra `events.jsonl` dạng
   `dispatch.admission` để audit.
4. **Mở rộng dần**: khả năng chịu tải theo từng target bắt đầu hẹp
   (trần theo target = 1) và chỉ mở rộng sau các lần dispatch sạch
   liên tiếp; bất kỳ lỗi nào trên 1 target đưa nó về lại trần hẹp.
   Việc này tổng quát hóa `_surface_registry.FRAGILE_UNDER_CONCURRENCY`,
   vẫn giữ vai trò bảng mầm khuyến nghị phía orchestrator như hiện tại.

Thông tin domain chỉ đi vào qua dữ liệu: chú giải objective do
`objective_expand`/`add_objective`/registry ghi, và 1 block tùy chọn
`metadata.fanout` trong frontmatter skill được bên sinh ra tiêu thụ.
Không có nhánh `if domain == ...` nào trong cổng này.

## Hệ quả

- **Dễ hơn:** fan-out AD/cloud/network được kế thừa cùng mức an toàn
  mà ma trận web đã tự tay tinh chỉnh; lockout do concurrency và kẹt
  do 1-worker trở thành bị chặn về mặt cấu trúc thay vì hy vọng qua
  prompt; admission đo được từ `events.jsonl`.
- **Khó hơn:** mọi nơi sinh ra objective con nên chú giải
  `effects`/`resources`/`parallel_safe` — việc mutate chưa chú giải sẽ
  bị serialize, đánh đổi throughput để lấy an toàn theo mặc định;
  prompt orchestrator phải dạy các field này và hợp đồng mã reject.
- **Đánh đổi:** không còn ảo tưởng rằng 1 bộ đếm slot toàn cục là 1
  control an toàn; nó chỉ còn là trần ngoài cùng.
- **Migration:** không có — các field `Objective` mới tùy chọn với
  default an toàn; plan, registry hiện có, và đường cờ-tắt hành xử
  đúng như trước.

## Phương án đã xem xét và loại bỏ

- **Code scheduler theo từng domain** (`if role == "ad_operator"`):
  loại — mỗi domain mới lại phải mở lại scheduler, và công việc
  registry của codebase (ADR-0075) vừa thiết lập việc suy ra theo dữ
  liệu target làm chuẩn mực.
- **Kỷ luật lập lịch chỉ qua prompt**: loại — không xác định và từng
  bị bỏ qua dưới tải; ADR-0067 tồn tại chính vì điều này.
- **Xếp hàng dispatch bị từ chối**: loại — 1 dispatch mutate bị xếp
  hàng vẫn sẽ bắn sau đó vào 1 context mà orchestrator tin là đã cũ;
  từ chối có cấu trúc giữ orchestrator ở vị trí quyết định.
- **Mở rộng `recommended_in_flight` (khuyến nghị) thay vào đó**: loại
  — nó chỉ thông báo mà không ràng buộc; các incident đã xảy ra dù có
  nó.
