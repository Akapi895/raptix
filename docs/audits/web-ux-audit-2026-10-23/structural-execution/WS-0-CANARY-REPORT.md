# WS-0 · Báo cáo canary cách ly theo actor

Trạng thái: **VERIFIED trên stack cô lập** (10/10). Phần draft chat với thread runtime: NV (không có runtime trong stack). Mã sản phẩm kiểm: `67ddf571`.

## Môi trường

- Stack cô lập dựng bằng `tools/verify/stack.mjs` (không đổi trong repo), chạy từ bản sao có cờ giữ (`stack-hold.mjs`, tạo trong scratchpad).
- Container PostgreSQL và Neo4j có tên ngẫu nhiên, nhãn `raptix.verification=stack`, dữ liệu tmpfs; cổng tự cấp (không dùng 3001 hoặc 5273).
- Tài khoản: owner (verifier) tạo bởi bootstrap của stack; viewer và reviewer tạo qua API của stack và được thêm làm thành viên của project fixture.
- Credential sinh ngẫu nhiên mỗi lần, đi qua biến môi trường của tiến trình con, không ghi vào repo. File `hold.json` nằm trong scratchpad và được xóa sau phiên.
- Không tạo tài khoản trên 3001; không đổi authentication hay authorization.

## Kịch bản và kết quả

Script: `structural-execution/verify-scripts/actor-canary.mjs`. Hai actor dùng chung một browser context.

| # | Kiểm tra | Kết quả |
|---|---|---|
| 1 | Fixture: project chỉ owner (không có viewer là thành viên) | PASS |
| 2 | Owner thấy project chỉ owner trong danh sách | PASS |
| 3 | Owner đăng xuất: không còn khóa storage nào chứa định danh owner hoặc project chỉ owner | PASS |
| 4 | Viewer đăng nhập trên cùng browser: trong 4 giây, tên project chỉ owner không xuất hiện lần nào (kể cả thoáng qua từ cache) | PASS |
| 5 | Danh sách của viewer có project dùng chung, không có project chỉ owner | PASS |
| 6 | `GET /api/engagements` bằng session viewer không trả id project chỉ owner (phạm vi phía server khớp phía client) | PASS |
| 7 | Storage của viewer không chứa dữ liệu owner | PASS |
| 8 | Viewer đăng xuất, owner đăng nhập lại: vẫn thấy project của owner | PASS |
| 9 | Thay phiên ở tab thứ hai: tab thứ nhất bỏ dữ liệu owner sau khi viewer đăng nhập ở tab hai | PASS |
| 10 | Không có lỗi trang | PASS |

Kết quả: `checks=10 failed=0 pageErrors=0`. Chạy hai lần: lần một trên stack của vòng này trước các sửa UI (cùng mã cache); lần hai trên stack của HEAD cuối (`67ddf571`).

## Lỗ hổng phát hiện bằng mutation (đã khôi phục)

- Mutation: đổi `key={actor}` của `ActorQueries` thành hằng số (một `QueryClient` dùng chung cho mọi actor).
- Canary: vẫn 10/10. Lý do: đăng xuất khiến `ActorQueries` unmount và xóa client, nên đường chuyển actor trong canary không đi qua chỗ bị phá. Key project đã có actor từ WS-0 nên cũng không lộ.
- Test đơn vị `real-login.test.tsx` (lịch sử in-flight của actor trước): **đỏ** với mutation. Đây là lớp bảo vệ bất biến "một client cho mỗi actor".
- File đã khôi phục bằng `git checkout`, không còn thay đổi.

Kết luận: canary bảo vệ đường đăng xuất/đăng nhập và phạm vi server; bất biến chuyển actor không unmount được bảo vệ bởi test đơn vị. Cả hai được giữ.

## Giới hạn còn lại (NV)

- Bản nháp chat và lựa chọn thread: cần thread runtime (LangGraph) không có trong stack. Phần cô lập đã có unit test (`features/aichat/session.test.ts`, `real-login.test.tsx`).
- Chiều ngược lại (viewer rồi owner) với dữ liệu owner trong storage: chưa có fixture dữ liệu viewer để so sánh.
- Cờ planning-seed (sessionStorage, khóa theo actor): unit test, chưa có canary trình duyệt (cần tạo project trong UI).

## Bằng chứng

- `structural-execution/verify-scripts/actor-canary.mjs` (không chứa credential; đọc `hold.json` theo đường dẫn tham số).
- Kết quả JSON của lần chạy cuối nằm trong scratchpad (không đưa vào repo vì chứa id fixture cục bộ).
