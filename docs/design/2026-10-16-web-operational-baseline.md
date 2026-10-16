# O01 baseline — reconciled scope và release baseline

> **Follow-up verification 2026-10-16:** [báo cáo O01–O03](2026-10-16-o01-o03-verification.md)
> ghi O01 partial, O02/O03 blocked. Roundtrip hiện tại không còn xác nhận claim
> “workspace đã fix” ở §2.1; deployment cũng chưa chứa các thay đổi O03 trong
> working tree. Các quan sát dưới đây giữ nguyên như evidence của lần kiểm tra trước.

- **Ngày:** 2026-10-16 · work item **O01** của
  [mock-to-operational plan](2026-10-16-web-mock-to-operational-system-implementation-plan.md).
- **Tính chất:** quan sát source + probe deployment. Không phải bằng chứng
  workflow E2E; các mục "available" là availability, không phải certification.
- **Tracking:** tài liệu này tham chiếu
  [coverage.md](../../apps/web/.scratch/frontend-backend-integration/coverage.md)
  (18 package) — không tạo tracker cạnh tranh.

## 1. Source và image đang chạy

| Thành phần | Giá trị ghi nhận 2026-10-16 |
|---|---|
| Source | `2012e694611ca1221b5b4e8a55d7b6d40fa95c9a` (HEAD = `origin/web-improve-refactor`), commit “feat(web): split execution surface, modal inspector and mock vault tab” |
| Working tree | 11 dirty entries của user (`.gitignore` benchmarks/scenarios, `GLOSSARY.md` instance terms, `docs/skill-cleanup-*`, untracked plan/research/report-vdt/infra-test.log) — tôn trọng, không đảo |
| UI image | `ghcr.io/akapi895/raptix-web-raptix-ui:stable` = `sha256:42063a629d60…`, container recreate `2026-10-16T09:23:50Z`, asset `index-BAP_93HV.js`, build `VITE_DATA_MODE=mock` (real qua `?dataMode=real`) |
| API image | `ghcr.io/akapi895/raptix-web-raptix-api:stable` = `sha256:53dfcbdef25f…` (healthy) |
| Runtime | langgraph `f6f68c23`, litellm `9c235e0f`, sandbox `fa8ad733`, skillogy `e2aa2a60` (đều `:stable`, healthy) |
| Data stores | `postgres:17-alpine`, `neo4j:5.26.28-community` (healthy); workspace volume theo Compose web-raptix |
| Khác | Juice Shop chiếm `:3000`; console `:3001`; không có container C2 provider |

**Probe `/api/capabilities` (2026-10-16):** `mode=multi-user`; agents, projects,
planning, threads, runs, approvals, artifacts, findings, graphs, timeline,
reports, **campaigns**, vault, members `available:true`; `c2` `available:false`,
reason `provider_unavailable`. `/api/health/ready` → 200. Delta so với §2.1 của
plan: `campaigns` nay báo available — vẫn chỉ là availability, chưa phải bằng
chứng provider workflow.

**Đã biết chưa đối chiếu:** SHA source ↔ image `42063a62` chưa chứng minh khớp
(image build log/label chưa kiểm tra; asset hash khác build `B7_PfONI` trước đó
của phiên làm việc trước). Ghi vào O14 khi làm release manifest.

**Lỗi Compose đã biết:** root `.env` có BOM → plain `docker compose` fail
(`\ufeff` in variable name). Không sửa `.env`; deploy UI dùng compose tạm ngoài
repo (`%TEMP%/opencode/execution-ui-deploy.yml`, `--env-file NUL`). Lưu ý khi
chạy runbook §6.1 của plan.

## 2. Prisma migrations (19 dirs) và O02 probe nhanh (2026-10-16)

- **Migration status (authoritative, chạy trong API container):** database
  `raptix_web_raptix`, **19 migrations found — "Database schema is up to
  date!"**. DB chứa thêm các row lịch sử cũ (123 rows trong `_prisma_migrations`
  từ các squash trước) — không phải drift; `migrate status` xác nhận khớp.
- **Volumes:** postgres `raptix_postgres_data` ✓; neo4j data/logs ✓; runtime
  checkpoints `raptix_langgraph_state` (`.langgraph_api`) ✓; API workspace
  volume `raptix_workspace_data` ✓ persistent.
- **Config:** `RAPTIX_WEB_AUTH_MODE=multi` ✓; `VAULT_ENCRYPTION_KEY` đã set ✓
  (backup/rehearsal key vẫn còn ở O02/O14); `LANGGRAPH_API_URL` trỏ langgraph
  ✓. Inference thật chưa smoke (cần account).
- **Mock baseline:** image `42063a62` smoke lại qua browser — AI Workspace hiển
  thị hội thoại + Recon #1/#2 đúng split surfaces, không API write, không page
  error ✓.

### 2.1 O02 P0 — workspace storage: ĐÃ FIX theo option 1 (2026-10-16)

Ban đầu roundtrip **fail** (API volume ≠ runtime workspace). Đã chốt và áp
dụng **option 1** (người dùng duyệt): API bind host workspace root + pin slug
runtime, giữ nguyên runtime/launcher.

Thay đổi đã áp dụng (override compose tạm ngoài repo:
`%TEMP%/opencode/workspace-topology-override.yml`, áp cùng
`docker-compose.web-raptix.yml`):

- `RAPTIX_WORKSPACE_PATH` hiệu lực mount: host root
  `D:/.VTNet/redteam/raptix/.raptix/workspace` → `/workspace` (volume
  `raptix_workspace_data` không còn mount vào API; data trong volume vẫn còn
  nguyên, planning docs của `juice-shop-v4` đã được copy sang host root trước
  khi chuyển).
- `RAPTIX_RUNTIME_WORKSPACE_SLUG=juice-shop-v4-r2` — slug thật mà runtime pin
  (probe marker xác nhận runtime `/workspace` =
  `D:\...\.raptix\workspace\juice-shop-v4-r2`; giá trị cũ
  `RAPTIX_ENGAGEMENT_WORKSPACE=/mnt/d/.../juice-shop-v4` trong .env là stale).
- `RAPTIX_WEB_ADMIN_*` bootstrap (xem §2.2).

**Bằng chứng sau fix (2026-10-16):**

- Roundtrip marker: `o02-rt-1792144544` ghi qua API
  `/workspace/juice-shop-v4-r2/.o02-roundtrip` đọc được nguyên văn trong runtime
  `/workspace/.o02-roundtrip`; đã dọn cả hai phía.
- `prisma migrate status` sau recreate: vẫn "up to date" (19/19).
- API healthy, `/api/capabilities` mode `multi-user`.
- Workspace runtime không bị đụng (chỉ thêm/xóa marker `.o02-*`).

**Lưu ý vận hành:** nếu recreate API bằng plain compose (không kèm override)
sẽ mất host-bind + pinned slug. Cần fold các env này vào `.env`/compose chính
thức trước cutover (O14).

### 2.2 O02 — accounts multi-user đã bootstrap (2026-10-16)

- Cơ chế: `RAPTIX_WEB_ADMIN_*` trong env API → `ensureBootstrapAdmin` lúc
  startup (idempotent). User `admin` đã tồn tại sẵn trong DB từ deployment cũ
  (password chỉ người dùng biết) nên bootstrap thêm hai account test riêng:
  - `o02admin` / owner — displayName "O02 Test Admin"
  - `o02reviewer` / reviewer — membership trên engagement `juice-shop-v4-r2`
- Passwords lưu tại `%TEMP%/opencode/{admin,reviewer}-pw.txt`, đã bàn giao
  ngoài tài liệu này (không ghi secret vào repo).
- Engagement test: `juice-shop-v4-r2` (id `cmvasqjuv000136qqd78h8itk`,
  target `http://juice-shop:3000`, do o02admin tạo qua API).
- Bằng chứng browser: login `o02reviewer` qua form real mode tại `:3001` →
  vào Projects thấy "Juice Shop v4 R2", không page error, refusal đúng khi
  sai password (uniform 401).

## 3. Route/surface inventory — đối chiếu tại `2012e69`

### 3.1 Registry và mounting (source observation)

- `router/registry.tsx` MANIFEST: **55 route keys** (comment trong file ghi 55;
  `coverage.md` §3 vẫn ghi 53 — drift tài liệu, đã ghi ở §4).
- `router/host.tsx` `REAL_PAGES`: mount trực tiếp `overview`, `projects`,
  `project-new`, `project`, `ai-operator`→RealWorkspace, `assets`, `playbooks`/
  `playbook`/`technique`→RealLibrary, `command-center`→RealOverview,
  `tasks`→RealCommandCenter, `ai-history`/`ai-trace`→RealWorkspace, `settings`,
  `login`; **31 keys** còn lại → `RealFeatureRoute`; khi không có engagement
  context, 7 surface global (`infrastructure`, `findings`, `reports`,
  `operations`, `analysis`, `agents`, `c2`) → `RealGlobalResource`.
- `REAL_INTEGRATED_ROUTES` (not-integrated.tsx) chỉ còn là fallback cho key
  ngoài `REAL_PAGES` (thực tế ít khi chạm); comment "grows per integration
  ticket" đã lỗi thời so với phạm vi REAL_PAGES hiện tại.
- `feature-route.tsx` SURFACES: operations\* → Governance/Operations panels;
  agents/fanout/branch → Fleet; asset\* → Assets/Scope; findings\*/evidence\* →
  Findings/Curation; reports\*; ai-plan\* → Governance; c2\* → C2/Campaigns;
  playbook-review → LibraryReview. Tất cả scoped theo engagement selector, Empty
  state trung thực.

### 3.2 Project nav (shell/nav.ts)

- Mock (`MOCK_PROJECT_NAV`): Overview | Scope & ROE, Planning | **AI Workspace**
  (`ai-workspace`, match cả `ai-operator`/`ai-history`), **Execution**
  (`operations`, match `operation*`, `preflight`, `ai-trace`, `ai-fanout`,
  `ai-branch`), C2 Sessions | Findings, Evidence, Reports | Team & Approvals,
  Activity & Audit, Vault, Closeout.
- Real (`REAL_PROJECT_NAV`): như mock nhưng `planning` thay `plans`, `c2` thay
  `sessions`, thêm Fleet/Analysis; `ai-workspace` → `RealConversation embedded`;
  `operations` → `RealOperationsPanel`; Vault/Settings/Governance/Closeout là
  các tab Management thật.

### 3.3 Global nav

8 mục / 3 nhóm (Overview, Projects, Findings, Reports | Infrastructure, Assets,
Library | Settings); real badges rỗng (chưa có projection). Global surfaces còn
hiện **"Global source unavailable"**: findings, reports, operations, analysis,
infrastructure/agents/c2 (`global-resource.tsx`) → O12 / A15.

### 3.4 Mock-only surface khối lệnh Execution mới

Mock `b-detail.tsx` tại `2012e69`: `ai-workspace` → `ExecutionWorkspace`
(hội thoại giữa + Agents/Context + drawer history chứa OpsTab); `operations` →
OpsTab + `ExecutionTrace embedded` (inspector modal giữa màn hình). Vault mock
là metadata-only tab ở MANAGEMENT (CHANGELOG §Unreleased).

## 4. Phân loại tồn đọng (O01 bước 3)

| Loại | Nội dung | Owner |
|---|---|---|
| **Source mismatch (doc/comment)** | `coverage.md` ghi 53 keys vs MANIFEST 55; comment `not-integrated.tsx`/`host.tsx` ("there is no sign-in") lệch mode multi-user + RealLogin; naming Execution/AI Workspace trong plan/ADR cũ (đã đồng bộ phần lớn ở O01 bước 4) | O01/O14 — chỉnh doc, không đổi code |
| **Contract gap** | Per-instance messaging/control/identity runtime (O08); document draft/version/conflict API (O06); cross-project inventory API (O12); vault runtime credential reference (O10); schedule-cancel expected-version (O07) | Packages 01/04/05/06/07/08/09/10/11/12/13 |
| **Configuration gap** | C2 provider bridge chưa deploy (`provider_unavailable`); `VAULT_ENCRYPTION_KEY` persistence; model route inference chưa smoke; auth accounts/membership bootstrap chưa nghiệm thu; runtime workspace/checkpoint durability chưa đo roundtrip | O02 (O12 cho C2) |
| **Evidence gap** | Live multi-user E2E (A01–A16); source↔image SHA match; migration upgrade/clean-DB; SSE revoke-mid-stream; schedule dispatcher khi đóng browser; backup/restore/rollback rehearsal | O02/O05/O14 + từng Oxx |

Regression/evidence cũ vẫn hợp lệ giữ nguyên (không reset 18 package); các mục
trên chỉ bổ sung góc nhìn vận hành.

## 5. Wording sync đã làm (O01 bước 4)

- `CHANGELOG.md`: entry execution → "AI Workspace combines …; Execution keeps
  operations/runs + tool-call trace".
- `docs/adr/0078`: câu mở khớp naming AI Workspace/Execution/C2 (nội dung
  boundary không đổi).
- Plan execution-agent-workspace: thêm "Cập nhật O01" vào header, giữ nguyên
  body lịch sử.
- Không reset hay sửa completion trong tracker 18 package.

## 6. Kết luận O01 và trạng thái O02

O01 hoàn tất: baseline khóa tại `2012e69` + image digests ở §1; inventory đối
chiếu xong ở §3; tồn đọng phân loại ở §4; wording sync xong ở §5. Mock baseline
chạy độc lập tại `:3001` (mock là build default; real qua `?dataMode=real`) —
đã smoke lại trên image `42063a62`.

O02 probe + fix xong (§2): migrations/volumes/vault key/auth mode xanh;
**P0 workspace storage mismatch ĐÃ FIX** theo option 1 với bằng chứng roundtrip
(§2.1); hai account test multi-user đã bootstrap và browser-verified (§2.2).
Còn mở: model inference smoke (thuộc golden path O05/A04), vault key
backup/restore rehearsal (O14), fold override env vào deployment chính thức
trước cutover.
