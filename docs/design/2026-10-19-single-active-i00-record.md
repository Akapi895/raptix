# I00 record: contract, baseline và phạm vi I01

- **Ngày:** 2026-10-19.
- **Plan:** [single-active-project-environments](2026-10-19-single-active-project-environments-implementation-plan.md).
- **ADR:** [0092](../adr/0092-single-active-project-environments.md) (Proposed).
- **Branch:** `feat/single-active`, tạo từ `web-improve-refactor` tại `e9b20969`. Worktree: `.claude/worktrees/single-active`.

## 1. Baseline đã ghi nhận

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| Server typecheck (`@raptix/web-raptix-server`) | Pass | Chạy sau `prisma:generate`. |
| Server test (`@raptix/web-raptix-server`) | 485/485 pass | Trước mọi thay đổi. |
| Contract test (`@raptix/web-contracts`) | 48/49 pass | Lỗi có sẵn: `tests/run-api.test.ts` "validates the truthful local single-user members view additively" (`isMembersView` trả `false`). Không thuộc plan; không sửa trong branch này, cần issue riêng. |
| Migration sạch | Áp đủ 26 migration hiện có lên Postgres 17 dùng một lần | Container `raptix-envtest-i01`, cổng `127.0.0.1:55432`, có label `raptix.test=i01`. |
| Runtime đang chạy | Không đổi | Snapshot chỉ đọc lưu tại `scratchpad/runtime-baseline-snapshot.txt` (102 dòng). Gồm 19 container của stack `raptix`, `raptix-web-raptix`, 4 sandbox `sbx-*` và `juice-shop`. |

Không chụp row hay schema của `raptix-web-postgres` trong I00. Theo quyết định của người yêu cầu, phần này chuyển sang I07.

## 2. Default trong plan §1.2 được chốt

- Project chưa dùng chỉ có metadata và storage. Container tạo khi activate lần đầu.
- Xem project, finding, report không tự activate runtime.
- Khi project A còn run, tool hoặc câu hỏi, mở B trả trạng thái `busy`. Không kill A và không chạy song song. Chuyển sang B chỉ bằng stop-and-switch rõ ràng, và phần này thuộc I06.
- Pause không giải phóng slot.
- Restart laptop hoặc API không tự resume. Phải reconcile trước.
- Archive và stop giữ dữ liệu. Xóa vĩnh viễn là thao tác riêng (xem §4).

## 3. Transport của host controller

- Controller là module Go nằm trong `apps/launcher`, chạy trên host, lắng nghe HTTP ở `127.0.0.1`.
- Container API truy cập qua `host.docker.internal`. Cần xác minh trên Docker Desktop Windows ở I02.
- Xác thực bằng bearer token riêng cho từng deployment. Token được mount chỉ vào container API, không vào runtime hay sandbox, và không đưa vào env hay log.
- Giới hạn request body 64 KiB. Mỗi lệnh có timeout 30 giây. Việc lâu chạy bất đồng bộ và kết quả được quan sát bằng polling.
- Không lấy Docker socket cho Fastify, runtime hay sandbox.

Phương án đã loại: unix socket (Windows không dùng được), named pipe (phức tạp với Docker Desktop), gRPC (thêm dependency mới).

## 4. Chính sách xóa

- Codebase hiện không có đường xóa project. `projects-service.ts` không có hàm delete.
- Trong I01–I06, không có hard-delete. Stop và archive là hai thao tác duy nhất có trong phạm vi.
- Hard-delete phải có ADR riêng, retention policy riêng và resource disposition. Nút "Delete Project" không dùng `docker compose down -v`.

## 5. Routing mode và legacy

- Mỗi project có routing mode `legacy` hoặc `environment`. Không có fallback tự động.
- Trong I00 mới chỉ xác định được nguồn legacy: CLI dùng `RAPTIX_ENGAGEMENT` và raw URL; Web dùng một `web-runtime` và volume `web_runtime_workspace` dùng chung. Việc map sang project canonical thuộc I07.

## 6. Phạm vi I01 đã chốt

Mục tiêu: registry bền vững, lifecycle intent có idempotency, và slot toàn deployment được thay đổi bằng CAS.

**File dự kiến (runtime, ≤10 file, ≤400 dòng mỗi patch):**

| File | Vai trò |
|---|---|
| `apps/web/server/prisma/schema.prisma` | Thêm 3 model: `DeploymentSlot`, `ProjectEnvironment`, `EnvironmentCommand`. Chỉ additive. |
| `apps/web/server/prisma/migrations/20261028000000_project_environments/migration.sql` | Migration additive, không đổi bảng cũ. |
| `apps/shared/web-contracts/src/environments.ts` | DTO và validator cho command, slot, binding. Export qua `index.ts`. |
| `apps/web/server/src/services/environments/project-environment-service.ts` | Service duy nhất cho admission và command. |
| `apps/web/server/src/services/runtime-ownership.ts` | Gọi kiểm tra admission trong transaction `reserve` cho `create_run` và `resume`. |

**Test:**

- Pure: validator trong `apps/shared/web-contracts/tests/environments.test.ts`.
- Real DB: `apps/web/server/tests/environment-admission-live.ts`, chạy thủ công với `DATABASE_URL` trỏ tới DB dùng một lần. Không dùng `*.test.ts` để tránh phụ thuộc DB trong suite mặc định.
- Các case bắt buộc của plan I01: hai actor cùng activate khác project chỉ có một winner; duplicate và mất ACK; crash sau reserve; version cũ; lease hết hạn không giải phóng slot; viewer hoặc foreign project bị từ chối.

**Ngoài I01:** route HTTP cho activate/stop (thuộc I03 và I05), controller, container thật, và mọi thay đổi Compose.

**Hành vi tương thích:** nếu chưa có dòng `DeploymentSlot`, slot được coi là `idle` và cho phép admit. Deployment hiện tại không thay đổi hành vi.

## 7. Điểm để lại cho I02 trở đi

- Xác minh `host.docker.internal` từ container API trên Docker Desktop Windows.
- Định nghĩa image digest allowlist và cách cấp bootstrap config cho environment.
- Threat model riêng cho thay đổi Compose hardening khi đến I02.
- Quyết định về Neo4j: role theo database hay scoped facade.
