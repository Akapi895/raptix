# 8. File của 1 project chỉ truy cập được qua đúng sandbox của nó; RoE và abort fail-closed

## Bối cảnh

Theo ADR-0086, mỗi project có 1 container sandbox riêng, nhưng các
container đó mount 1 subpath của 1 volume chia sẻ chung tại
`/workspace/<slug>`. Web API và runtime LangGraph mount toàn bộ volume
tại `/workspace`. 2 hệ quả xảy ra. Thứ nhất, tiến trình runtime — nơi
chạy agent và thực thi RoE — có thể đọc và ghi vào thư mục của mọi
project. Thứ hai, góc nhìn của agent về thư mục làm việc của nó chứa
slug project, nên đường dẫn mà LLM nhìn thấy bao gồm cả
`/workspace/<slug>/`.

Runtime đọc trực tiếp `plan/roe.json` và marker `.abort` từ filesystem,
và `middleware/roe.py` coi 1 tài liệu RoE không đọc được là ở mode
audit-only. Vì vậy bỏ mount volume mà không đổi đường đọc đó sẽ làm
RoE enforcement trở thành fail-open và tắt luôn nút dừng khẩn cấp. Đó
là lý do ADR này đổi cả layout lưu trữ và đường đọc cùng lúc.

LangGraph API ở cổng 2024 chấp nhận request không xác thực và chia sẻ
`raptix_web_sandbox-net` với các sandbox. 1 lệnh trong sandbox của 1
project có thể liệt kê thread của project khác. Sandbox còn nhận toàn
bộ `.env` của deployment qua `env_file`, gồm key provider và mật khẩu
admin, và `kernel/tmux.py` copy môi trường đó vào shell của agent.
Host Neo4j không truy cập được từ sandbox trong deployment này, nên
mật khẩu Neo4j trong sandbox không có tác dụng gì.

## Quyết định

1. **1 volume cho mỗi project.** Mỗi sandbox project mount 1 volume
   riêng có tên `raptix-ws-<slug>` tại `/workspace`. Không có subpath,
   không có đường dẫn chứa slug. Launcher tạo volume cùng file compose
   của sandbox. Thư mục plan `plan/` được tạo trong container.
2. **File đi qua sandbox.** Web API và runtime chỉ đọc/ghi file
   project qua daemon sandbox của chính project đó, dùng
   `/download_files`, `/upload_files`, và `/execute`. Web API dùng
   token project nó tự suy ra từ key sandbox. Runtime dùng
   `sandbox_token` mang theo mỗi run. Không bên nào mount bất kỳ
   volume project nào. Volume chia sẻ
   `raptix-web-raptix_web_runtime_workspace` không còn được service
   nào mount.
3. **RoE fail-closed khi đọc lỗi.** `roe.json` được đọc qua sandbox
   của run. Nếu sandbox không kết nối được, hoặc tài liệu tồn tại
   nhưng không đọc/parse được, mọi tool call bị gate đều bị từ chối
   với thông báo rõ `ROE_UNAVAILABLE`. Runtime không bao giờ rơi về
   mode audit-only trong các trường hợp này. 1 `roe.json` bị thiếu
   vẫn giữ ý nghĩa hiện tại, "không có tài liệu RoE, tắt machine
   enforcement", vì 1 project chưa có RoE trước khi lập plan. Đây là
   lựa chọn rõ ràng của ADR này; xem Hệ quả.
4. **Marker abort đọc qua sandbox, và sandbox không kết nối được tính
   là đã abort.** Nút dừng khẩn cấp của operator viết
   `/workspace/.abort` qua sandbox. Runtime kiểm tra nó qua sandbox
   trước mỗi tool call bị gate. Nếu sandbox không kết nối được, lệnh
   bị từ chối với thông báo `AGENT_HALTED` hiện có.
5. **Agent chỉ thấy `/workspace`.** `workspace_path` cấu hình được gửi
   tới runtime cho mỗi project là `/workspace`. Việc pin engagement
   của daemon, vốn hard-code `/workspace/{slug}`, bị bỏ khỏi môi
   trường sandbox, vì mount giờ chính là ranh giới.
6. **Xác thực Runtime API.** LangGraph API yêu cầu bearer token từ mọi
   caller (`interfaces/api/auth.py`, `auth` trong `langgraph.json`).
   Token sống trong file `runtime-api-token` ở thư mục secret và được
   mount read-only chỉ vào Web API và runtime. Route do app
   `plugins_api` tùy biến phục vụ cũng yêu cầu token này. 1 runtime
   không có token sẽ từ chối mọi request.
7. **Môi trường sandbox là allowlist.** File compose sandbox không
   còn truyền `env_file`. Nó chỉ đặt `SANDBOX_DAEMON`, `SANDBOX_TOKEN`,
   và không gì khác từ deployment. `NEO4J_*` bị gỡ bỏ, vì host Neo4j
   không truy cập được từ sandbox.
8. **Không migrate project hiện có.** 7 project trong bảng
   `Engagement` bị xóa cùng dữ liệu của chúng. Chủ sở hữu quyết định
   việc này vào 2026-10-25. Volume chia sẻ bị thu hồi. Việc xóa nó cần
   xác nhận riêng của chủ sở hữu, vì nó còn chứa thư mục không có
   trong database.
9. **Database không còn lưu đường dẫn workspace.** Cột
   `Engagement.workspacePath` bị xóa trong 1 migration, và không còn
   code nào đọc/viết nó.

Được chủ sở hữu chấp nhận là công khai: `/ok`, `/info` (version và
feature flag), `/docs`, và `/openapi.json` (schema route). Chúng không
lộ dữ liệu project nào.

## Hệ quả

- **Dễ hơn:** dữ liệu 1 project chỉ truy cập được từ đúng container
  của nó. 1 lệnh bị chiếm trong 1 sandbox không thể đọc file của
  project khác hay liệt kê thread của nó. Môi trường sandbox không
  thể lộ key của deployment.
- **Khó hơn:** mọi lần đọc tài liệu plan, mọi lần ghi artifact, và mọi
  kiểm tra RoE giờ đều gọi tới sandbox. 1 sandbox bị dừng vì vậy dừng
  luôn việc đọc tài liệu plan, ghi artifact, và tool call bị gate. Đây
  là chủ đích: 1 project không chạy thì không thể được quản trị.
- **Đánh đổi:** runtime không còn đọc được file của 1 project khi
  sandbox của nó down, và mật khẩu Neo4j trong sandbox đã biến mất. 7
  project hiện có và dữ liệu của chúng bị xóa, không migrate.
- **Lựa chọn rõ ràng cần xác nhận:** 1 `roe.json` bị thiếu vẫn ở
  audit-only. Nếu chủ sở hữu muốn nó fail-closed luôn, đó là 1 thay
  đổi 1 dòng cho bộ đọc RoE và 1 quyết định mới.
- **Migration:** chủ sở hữu chọn xóa. Các bước: xóa 7 project, bỏ
  `workspacePath`, redeploy API và runtime với file compose mới, tạo
  lại sandbox với template mới. `raptix web sandboxes sync` và việc
  dọn volume mồ côi chia sẻ bị thu hồi.

### Mô hình mối đe dọa

- **Tài sản:** file project và tài liệu plan; thực thi RoE và marker
  abort; token Runtime API; key sandbox dùng để suy ra token project;
  secret deployment trong `.env`.
- **Đọc/ghi chéo file giữa project qua sandbox:** bị chặn bởi volume
  riêng từng project và token mà mỗi daemon sandbox kiểm tra. Sandbox
  không có đường tới volume của project khác.
- **Đọc chéo file hoặc liệt kê thread chéo project qua Runtime API:**
  bị chặn bởi token runtime. Sandbox không bao giờ giữ nó.
- **Vượt RoE bằng cách làm tài liệu không đọc được hoặc sandbox không
  kết nối được:** bị chặn, vì cả 2 đều fail-closed.
- **Vượt abort bằng cách làm sandbox không kết nối được:** bị chặn,
  vì 1 sandbox không kết nối được tính là đã abort.
- **Đọc secret deployment từ sandbox:** bị chặn bởi allowlist môi
  trường.
- **Rủi ro còn lại:**
  - Runtime là code đáng tin. Nó giữ token runtime và token sandbox
    của mỗi run. Cả 2 lưu trong cấu hình run LangGraph, trong volume
    state của runtime, nên bất kỳ ai đọc được volume đó đều dùng được
    chúng.
  - `/info`, `/docs`, `/openapi.json` vẫn công khai. Chủ sở hữu chấp
    nhận điều này.
  - 1 sandbox vẫn có thể ra internet công khai và chạm route `/ok`
    của runtime trên `raptix_web_sandbox-net`.
  - Web API giữ key sandbox. Nó là bên giữ duy nhất ngoài launcher.
  - Web API nằm trên `raptix_web_sandbox-net` để chạm tới sandbox,
    nên 1 sandbox có thể gửi request tới nó. Route project của nó cần
    đăng nhập (mode multi-user); `/api/health` và `/api/capabilities`
    công khai.

## Phương án đã xem xét và loại bỏ

- **Giữ 1 volume chia sẻ và mount subpath theo từng project trong
  sandbox, còn runtime giữ nguyên toàn volume.** Loại: runtime vẫn đọc
  mọi thư mục project, và agent vẫn thấy `/workspace/<slug>`.
- **Chạy 1 container runtime cho mỗi project (ADR-0092).** Loại hiện
  tại: nhân đôi bộ nhớ runtime và không cần thiết để đóng đường đọc
  chéo project, điều mà token và volume riêng từng project đã đóng
  được rồi.
- **Tách network để sandbox không chạm được runtime.** Loại: runtime
  phải chạm được sandbox, và Docker không lọc được 1 chiều của 1
  network chia sẻ theo port.
- **Đổi cổng LangGraph khỏi 2024.** Loại: 1 cổng không phải là kiểm
  soát truy cập. 1 sandbox có thể chạm bất kỳ cổng nào trên network
  chia sẻ.
- **Đặt 1 reverse proxy kiểm tra token trước LangGraph.** Loại: xác
  thực tùy biến chạy in-process, phủ cả route streaming, và không cần
  thêm 1 hop.
- **Migrate 7 project.** Bị chủ sở hữu loại, người chọn xóa.
