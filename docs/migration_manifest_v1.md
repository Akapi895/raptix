# Migration manifest — Security Platform V1 (raptix)

**Căn cứ ownership:** `docs/repository_structure_v1.md` (nguồn quyết định ranh giới module và data ownership).
**Thứ tự implement:** `docs/migration_roadmap_v1.md`.
**Module path Go:** `github.com/Akapi895/raptix/backend`.

File này là sản phẩm của **Phase 0 (đối chiếu và danh sách migrate)**: pin commit nguồn, phân loại từng phase là tham chiếu / migrate / viết mới, và theo dõi trạng thái hoàn thành.

## Commit nguồn đã pin

| Repo | Commit | Ghi chú |
|---|---|---|
| `frameworks/strix` | `4c1f00d1ee5bac0880e66e325ba50ed18a0b182b` | fix(runtime): tear the sandbox down when staging is cancelled |
| `frameworks/CyberStrikeAI` | `f44adaddf399244f701bfefc6767f164fb3eec2c` | Update config.example.yaml |
| `frameworks/Claude-Red` | `24d7968bab4b883e7f13477afe0fd91f2df3b722` | Skill catalog source for Phase 2 |

- **CyberStrikeAI**: nguồn chính cho phần Go (cấu trúc `cmd/`, `internal/`, catalog, MCP, model integration).
- **Strix**: nguồn chính cho content, agent loop, sandbox, verification.
- Đây là **hướng tìm kiếm**, không phải mapping file 1:1 đã kiểm chứng. Coding agent phải xác nhận khả năng thực tế trong phiên bản nguồn; phần không có/không phù hợp thì viết mới theo kiến trúc V1.

## Phân loại & trạng thái theo phase

Legend: `tham chiếu` = đọc nguồn để lấy kiến thức tổ chức, viết mới theo đích; `migrate` = chuyển hành vi từ nguồn; `viết mới` = không có nguồn phù hợp, viết theo V1.

| Phase | Nội dung | Phân loại chính | Trạng thái |
|---|---|---|---|
| 0 | Đối chiếu + danh sách migrate (file này) | viết mới | ✅ file này |
| 1 | Khung app + storage | tham chiếu (CyberStrikeAI Go layout), viết mới wiring/persistence | ✅ |
| 2 | Content, catalog, model adapter | migrate (Claude-Red skills; CyberStrikeAI tool model), viết mới Go contracts/adapters | ✅ |
| 3 | Dữ liệu lõi + quyền tối thiểu | migrate cả hai | ✅ |
| 4 | Một capability qua execution | migrate (Strix sandbox/tool; CyberStrikeAI capability) | ⏳ |
| 5 | Một agent hoàn chỉnh + verifier | migrate (Strix agent loop; adapter Go có sẵn) | ⏳ |
| 6 | Độ tin cậy execution/run | migrate (lỗi/restart), triển khai theo Postgres+V1 | ⏳ |
| 7 | API, CLI, UI cơ bản | migrate (CLI/API cả hai), UI mới React/TS | ⏳ |
| 8 | Review, report, jobs | migrate cả hai (finding/report; River) | ⏳ |
| 9 | Memory, knowledge, context | tùy chọn từ cả hai, không mặc định chép | ⏳ |
| 10 | Điều phối nhiều agent | migrate (Strix coordination; CyberStrikeAI orchestration) | ⏳ |
| 11 | Integration & release | migrate (CyberStrikeAI MCP/catalog; Strix capability) | ⏳ |

## Ghi chú cắt ngang

- Migration chạy qua bước release riêng (`cmd/migrate`), không tự chạy ở mỗi lần HTTP server khởi động.
- `app/` là composition root, không mang nghiệp vụ severity/review/retention.
- `sqlc.yaml` cấu hình output riêng từng module; không có generated package chứa toàn bộ query.
- Database V1 chỉ chạy thử; schema bảng/trường nghiệp vụ chưa chốt.

## Phase 1 — Đã migrate

- **Viết mới (theo kiến trúc V1):** `internal/app` composition root, `LoadConfig` + `NewLogger` (slog), adapter `internal/api`, adapter `infrastructure/database/filesystem`, `cmd/server` + `cmd/migrate`, `Makefile`, `scripts/`, `.github/workflows/ci.yaml`, `deploy/compose.yaml` (PostgreSQL 17), `README.md`.
- **Tham chiếu từ CyberStrikeAI (chỉ tổ chức):** chia `cmd/` (server, migrate) riêng khỏi `internal/`; không copy runtime, không dùng SQLite/zap — đích là PostgreSQL + pgx + slog.
- **Migration governance đã chạy:** `backend/migrations/00001_enable_extensions.sql` (pgcrypto) qua `cmd/migrate -command up`, verify bằng `status`.
- **Blocker đã sửa:** bổ sung `github.com/jackc/puddle/v2 v2.2.2` vào `go.mod`/`go.sum`; `go test -mod=readonly ./...` chạy sạch.
- **Còn thiếu (phase sau):** River, `contracts/openapi`, `containers/app/Dockerfile`, sandbox. (`sqlc.yaml` và filesystem artifact đã nhập Phase 3.)

## Phase 2 — Đã migrate

- **Content catalog:** loader YAML/Markdown schema-validated, path-contained, provenance hash/version/path, profile prompt/reference validation, và 78 skills từ Claude-Red revision đã pin.
- **Tool catalog:** nmap manifest giữ source path và CyberStrikeAI revision đã pin; registry tách declaration, binding và readiness, không cấp execution right.
- **LLM:** business contract cùng OpenAI-compatible Eino adapter, HTTP/SSE mock regression tests.
- **Không thuộc Phase 2:** tool dispatch/sandbox, governance, agent loop, evidence persistence và finding verification.

## Phase 3 — Đã migrate + hardening + validate live

- **Persistence:** `sqlc.yaml` cấu hình output riêng từng module; `sqlc generate` tạo 7 package `storegen`. Mười goose migration (00001–00010) chạy qua `cmd/migrate`; `00009_phase3_hardening.sql` thêm CHECK/UNIQUE ràng buộc (version>0, status/severity/confidence enum, sha256 format, size>=0, raw/derived parent rule), `00010_phase3_fixes.sql` sửa các lỗi do review (xem dưới) — DB chủ động từ chối dữ liệu sai, không chỉ ở service.
- **Review fixes (00010 + storage):** scope version cấp bằng counter nguyên tử trên `projects.scope_version` (thay cho `MAX(version)` cùng statement với `FOR UPDATE`, vốn không an toàn dưới READ COMMITTED — verify bằng test 8 goroutine tạo scope đồng thời ra version 1..8); `artifacts.parent_id` chuyển `ON DELETE RESTRICT`; raw artifact không được có rel_type; CHECK outcome cho audit; thêm index (sha256, run_id, finding_id, capability grant subject+scope); `TransitionFindingWithHistory` lấy `from_status` từ chính row update; `LinkEvidence` validate role + upsert; `DecideApproval` tái kiểm tra scope; **evidence chuyển sang content-addressed storage** — key `sha256/<checksum>` sinh từ bytes (không do caller cấp), bytes trùng nội dung dùng chung 1 file (dedup an toàn), loại bỏ hoàn toàn lỗi ghi đè/va chạm storage key.
- **platform/projects:** Project/Scope/Membership; scope **versioned thật** — `CreateScope` cấp `MAX(version)+1` dưới khóa project row, kèm `UNIQUE(project_id, version)` (verify live: tạo scope lần lượt ra version {1,2}). `IsScopeActive` là service contract xét scope hết hạn + project archived.
- **platform/governance:** role/permission, capability grant (revoke/expiry), approval; `GrantCapability`/`CheckActiveGrant`/`CreateApproval` đều gọi `ScopeAuthority` (projects) — **quyền không còn hiệu lực khi scope hết hạn hoặc project bị archived**. Approval hết hạn bị từ chối khi quyết định. Grant bắt buộc `granted_by`.
- **platform/audit:** audit_records; decision allow/deny của `run.start` được ghi tự động (co-relate bằng run id).
- **engine/runs:** lifecycle run/task/agent optimistic version; `CreateTask` chỉ nhận trạng thái khởi đầu hợp lệ, `CreateAgent` xác nhận task thuộc run, `AddTaskDependency` là service method chặn cross-run. Reads có tại service boundary (`GetRun`, `GetTask`, `GetAgent`, `ListRunsByProject`).
- **workspace/evidence:** `Register` nhận `io.Reader` — service tính size+SHA-256 từ bytes thật, ghi qua `filesystem.Store`, **verify bằng cách đọc lại rồi mới insert metadata**; nếu lưu metadata fail thì xóa bytes (không có artifact "dangling"). `ReadRef` đọc bytes lại; lookup SHA chuẩn nhất định theo run (`GetBySHA256InRun`) vì bytes có thể trùng giữa các run.
- **workspace/assessment:** asset/observation/**hypothesis (service method `RecordHypothesis`)**/coverage; `verified_negative` bắt buộc có evidence. Đủ read tại service boundary (Get/List per entity).
- **workspace/findings:** finding + evidence links + review history; `TransitionStatus` là **một statement atomic** (`TransitionFindingWithHistory` CTE): status/version và history không thể tách rời, stale version → optimistic lock, không ghi history. `RecordVerdict` không đổi status.
- **Composition root:** `wireServices(pool, fs)` gắn 7 service, governance nhận projects service contract, evidence nhận filesystem store. `StartAuthorizedRun` (app use case) ép membership + scope active + grant `run.start` + audit allow/deny trước khi tạo run.
- **Kiến trúc:** `tests/architecture/imports_test.go` đã sửa matcher đường dẫn (trước false-pass) và assert từng luật inspect ≥1 package, /storegen match theo path segment.
- **CI:** bước `Migrate` chạy `cmd/migrate up` trước `Test` trên `raptix_test`; test integration tự-lặp (slug/bytes unique, lookup theo run).
- **Đã validate live:** PostgreSQL 17 qua Docker Desktop 10/10 migration applied; `TestPhase3IntegrationDataFlow` chạy PASS **nhiều lần liên tục trên cùng DB** (repeatable) với đủ deny-path: project+scope{1,2}→member→denied run(no grant)→grant→authorized run→read-back→task/agent→artifact bytes write+checksum+read→observation/hypothesis/coverage→finding draft+evidence+atomic review+verdict(no flip). Thêm `TestPhase3ConcurrentScopeVersions` (8 scope đồng thời → version 1..8). Audit ghi cả allowed lẫn denied; ràng buộc DB từ chối dữ liệu sai (verify trực tiếp).

