# 7. Cho phép 1 operator đơn lẻ tự quyết định việc của chính mình khi deployment cho phép

## Bối cảnh

9 đường quyết định phía server từ chối 1 quyết định do chính người nộp
mục đó đưa ra: quyết định plan, quyết định sửa phạm vi, review finding
và review nội dung, quyết định đóng, quyết định cấp quyền C2, quyết
định đề xuất thư viện, và review báo cáo. Báo cáo còn yêu cầu người
review được chỉ định (nếu có) phải là người quyết định. Cơ chế gác
(`requireIndependentActor`) được viết để 1 danh tính cục bộ không thể
tự phê duyệt việc của chính mình.

1 deployment do 1 người chạy không thể hoàn tất các luồng này: người
duy nhất có thể nộp 1 mục cũng là người duy nhất có thể quyết định nó.
Lần acceptance ngày 2026-10-24 cho thấy cơ chế gác từ chối 1 quyết
định cùng-tác-nhân trên 1 plan đề xuất (quyết định của chính tác giả
trả về 403 kèm thông báo về tính độc lập), và mã nguồn cho thấy cùng
kiểm tra này trên mọi đường kể trên. Operator yêu cầu 1 sản phẩm
single-user, nên cơ chế gác phải cấu hình được cho deployment đó.

## Quyết định

Thêm 1 cấu hình deployment `RAPTIX_WEB_SINGLE_OPERATOR=1`, đọc 1 lần
lúc khởi động. Mặc định tắt.

Khi cấu hình bật:

- `requireIndependentActor` trả về mà không từ chối. Cả 9 đường quyết
  định đều chấp nhận quyết định do chính người nộp đưa ra, và mỗi
  quyết định vẫn được ghi kèm tác nhân của nó.
- Người review được chỉ định của 1 báo cáo có thể là tác giả báo cáo
  đó. Readiness cũng chấp nhận lựa chọn này (service báo cáo có quy
  tắc riêng "khác tác giả", thuộc cùng nguyên tắc four-eyes).
- Server công bố `independentReview: "single-operator"` trong tài
  liệu capabilities. Web console đọc giá trị này và không còn ẩn các
  control quyết định khỏi người nộp. Khi cấu hình tắt, tài liệu công
  bố `"required"`, và console giữ hành vi hiện tại.
- Server ghi 1 cảnh báo lúc khởi động.

Không đổi ở cả 2 mode: quy tắc chỉ-tác-giả (ví dụ chỉ tác giả gốc mới
sửa được 1 đề xuất thư viện, và chỉ người yêu cầu mới hủy được 1 quyết
định đóng), quy tắc chỉ người review được chỉ định của báo cáo mới
quyết định review của nó, sàn vai trò (role floor), kiểm tra
session/CSRF, và mọi kiểm tra RoE và khung thời gian.

Cũng thay đổi ở cả 2 mode, như 1 sửa lỗi: chủ engagement là 1 người
review hợp lệ được chỉ định cho báo cáo. Chủ sở hữu giữ vai trò owner
qua quyền sở hữu và không có dòng membership, nên trước thay đổi này
owner hoàn toàn không thể được chỉ định, và 1 báo cáo không thể được
duyệt bởi chính người sở hữu engagement đó.

## Mô hình mối đe dọa

Tài sản: tính toàn vẹn của các phê duyệt gác plan, phạm vi, finding,
báo cáo, đóng, và cấp quyền C2.

Mối đe dọa quy tắc four-eyes xử lý: 1 session đơn lẻ, hay 1 hành động
bất cẩn, tự phê duyệt việc mà người khác nên kiểm tra lại. 1 báo cáo
gửi khách hàng hay 1 cấp quyền C2 được phê duyệt mà không có người thứ
2 là trường hợp nghiêm trọng nhất.

Single-operator mode thay đổi gì: bất kỳ account có vai trò quyết định
đều có thể tự phê duyệt plan, sửa phạm vi, finding, báo cáo, đóng, hay
cấp quyền C2 của chính mình. Không có gì trong server kiểm tra có
người thứ 2 đã xem qua. Vì vậy 1 session owner bị đánh cắp có thể tự
phê duyệt mục của chính nó.

Giảm nhẹ: cấu hình tắt mặc định và phải được đặt rõ ràng trong môi
trường. Server ghi cảnh báo lúc khởi động. Tài liệu capabilities công
bố mode này, nên console hiện rõ. Session multi-user với kiểm tra
CSRF và origin vẫn áp dụng, nên cấu hình này không làm yếu xác thực.
Tác nhân được ghi trên mọi quyết định, nên audit trail vẫn cho thấy ai
đã phê duyệt gì. 1 deployment multi-user không được đặt biến này; bản
ghi này khuyến nghị các engagement cần phê duyệt độc lập từ khách hàng
nên giữ nó tắt.

Rủi ro còn lại: chủ deployment chấp nhận khi bật cấu hình này. Server
không giảm nhẹ: sự phê duyệt của 1 người không phải là bằng chứng của
1 review độc lập, và báo cáo hay cấp quyền C2 được phê duyệt theo cách
này không nên trình cho khách hàng như đã được review độc lập.

## Hệ quả

- **Dễ hơn:** 1 người có thể chạy toàn bộ workflow (plan, phạm vi,
  finding, báo cáo, export) mà không cần account thứ 2.
- **Khó hơn:** chủ deployment phải nhớ rằng phê duyệt từ 1 người không
  phải review độc lập; bất kỳ báo cáo gửi khách hàng dưới single-operator
  mode phải ghi rõ điều đó.
- **Đánh đổi:** không còn tính độc lập của quyết định do server thực
  thi, cho mọi deployment bật cấu hình này.
- **Migration:** không có cho deployment hiện tại. Mặc định tắt, nên
  hành vi không đổi trừ khi biến được đặt. Stack acceptance chỉ bắt
  đầu với biến này khi `stack.mjs --single-operator` được truyền vào.

File triển khai quyết định này: `server/src/auth/membership-policy.ts`,
`server/src/config/env.ts`, `server/src/main.ts`, `server/src/app.ts`,
`server/src/http/routes/capabilities.routes.ts`,
`server/src/services/reports-service.ts`,
`apps/shared/web-contracts/src/capabilities.ts`,
`apps/web/src/state/real-context.tsx`,
`apps/web/src/features/governance/tab.tsx`,
`apps/web/src/features/findings/presentation-context.ts`,
`apps/web/src/features/findings/detail.tsx`, và các test được nêu
trong pull request.

## Phương án đã xem xét và loại bỏ

- **Dùng account thứ 2 cho quyết định:** Loại. 1 người có 2 account
  phá vỡ quy tắc giống hệt 1 account đơn, và còn che giấu việc không
  có người thứ 2 nào xem qua.
- **Giữ quy tắc và chấp nhận phê duyệt bị chặn:** Bị operator loại,
  vì sản phẩm phải dùng được cho 1 người.
- **1 công tắc theo từng engagement:** Loại hiện tại. Nó thêm cấu hình
  vào mọi engagement và báo cáo gửi khách hàng, còn operator yêu cầu 1
  cấu hình toàn deployment.
