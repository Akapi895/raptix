# Migration manifest — Security Platform V1 (raptix)

**Căn cứ ownership:** `docs/repository_structure_v1.md` (nguồn quyết định ranh giới module và data ownership).
**Thứ tự implement:** `docs/migration_roadmap_v1.md`.
**Module path Go:** `github.com/Akapi895/raptix/backend`.

File này là sản phẩm của **Phase 0 (đối chiếu và danh sách migrate)**: pin commit nguồn, phân loại từng phase là `tham chiếu` / `migrate` / `viết mới`, và theo dõi trạng thái hoàn thành.

## Commit nguồn đã pin

| Repo | Commit | Ghi chú |
|---|---|---|
| `frameworks/strix` | `4c1f00d1ee5bac0880e66e325ba50ed18a0b182b` | `fix(runtime): tear the sandbox down when staging is cancelled` |
| `frameworks/CyberStrikeAI` | `f44adaddf399244f701bfefc6767f164fb3eec2c` | `Update config.example.yaml` |

- **CyberStrikeAI**: nguồn chính cho phần Go (cấu trúc `cmd/`, `internal/`, catalog, MCP, model integration).
- **Strix**: nguồn chính cho content, agent loop, sandbox, verification.
- Đây là **hướng tìm kiếm**, không phải mapping file 1:1 đã kiểm chứng. Coding agent phải xác nhận khả năng thực tế trong phiên bản nguồn; phần không có/không phù hợp thì viết mới theo kiến trúc V1.

## Phân loại & trạng thái theo phase

Legend: `tham chiếu` = đọc nguồn để lấy kiến thức tổ chức, viết mới theo đích; `migrate` = chuyển hành vi từ nguồn; `viết mới` = không có nguồn phù hợp, viết theo V1.

| Phase | Nội dung | Phân loại chính | Trạng thái |
|---|---|---|---|
| 0 | Đối chiếu + danh sách migrate (file này) | viết mới | ✅ file này |
| 1 | Khung app + storage | tham chiếu (CyberStrikeAI Go layout), viết mới wiring/persistence | ✅ |
| 2 | Content, catalog, model adapter | migrate (Strix content; CyberStrikeAI registry/MCP/model) | ⏳ |
| 3 | Dữ liệu lõi + quyền tối thiểu | migrate cả hai | ⏳ |
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

- **Viết mới (theo kiến trúc V1):** `internal/app` composition root (`New`/`Run`/`Serve` lifecycle), `LoadConfig` + `NewLogger` (slog), adapter `internal/api` (chi router + `GET /healthz` qua interface `Pinger`), adapter `infrastructure/database/filesystem` (blob atomic write/read/delete), `cmd/server` + `cmd/migrate` entrypoint, `Makefile`, `scripts/dev.sh` + `scripts/check.sh`, `.github/workflows/ci.yaml`, `deploy/compose.yaml` (PostgreSQL 17), `README.md`.
- **Tham chiếu từ CyberStrikeAI (chỉ tổ chức):** chia `cmd/` (server, migrate) riêng khỏi `internal/`; não copy runtime, không dùng SQLite/zap — đích là PostgreSQL + pgx + slog.
- **Migration governance đã chạy:** `backend/migrations/00001_enable_extensions.sql` (pgcrypto) qua `cmd/migrate -command up`, verify bằng `status`; `goose_db_version` ở version 1.
- **Blocker đã sửa:** bổ sung `github.com/jackc/puddle/v2 v2.2.2` vào `go.mod`/`go.sum`; `go test -mod=readonly ./...` chạy sạch.
- **Còn thiếu (phase sau):** River, sqlc.yaml, filesystem artifact gắn nghiệp vụ, contracts/openapi, `containers/app/Dockerfile`, sandbox.
