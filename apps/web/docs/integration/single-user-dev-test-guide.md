# Single-user dev-server test guide (web UI ↔ runtime hiện tại)

> Phạm vi chốt: **single-user**, chạy bằng **dev server** (không Docker cho UI/API),
> **không HITL**, **không multi-user/RBAC**. Hướng dẫn này dùng cho cả **agent con tự
> test** và **operator test manual**.

Mục tiêu: chứng minh web UI nói chuyện thật với core stack đang chạy
(`raptix-langgraph`, `raptix-postgres`, `raptix-neo4j`, `raptix-litellm`, `raptix-sandbox`),
và mọi trang dùng dữ liệu thật — không có fixture/demo fallback.

---

## 0. Kiến trúc khi test dev

```text
Browser (127.0.0.1:5273)
  └─ Vite dev server (apps/web)  --proxy /api-->  Fastify API (127.0.0.1:5280)
                                                      ├─ PostgreSQL  127.0.0.1:5433  (db: raptix_web_raptix)
                                                      ├─ Neo4j HTTP  127.0.0.1:7475
                                                      ├─ LangGraph   127.0.0.1:2400
                                                      └─ workspace  <RAPTIX_HOME>/workspace
```

Điểm sống còn: **API (host) và LangGraph (container) phải đọc cùng một thư mục
workspace.** LangGraph mount host dir tại `/workspace`, nên:
`WORKSPACE_PATH` (host) = `<RAPTIX_HOME>/workspace`, và
`RAPTIX_RUNTIME_WORKSPACE_ROOT` = `/workspace`.

---

## 1. Điều kiện tiên quyết

Chạy từ repo root `D:\.VTNet\redteam\raptix`.

### 1.1 Core stack phải healthy

```powershell
docker ps --format "{{.Names}} | {{.Status}} | {{.Ports}}"
```

Cần có (healthy): `raptix-langgraph` (2400), `raptix-postgres` (5433),
`raptix-neo4j` (7475/7688), `raptix-litellm` (4000), `raptix-sandbox`. Nếu thiếu:

```powershell
make infra
```

### 1.2 Node + dependencies

```powershell
node --version   # >= 22.12
npm ci
```

### 1.3 Build shared workspaces (bắt buộc trước khi chạy UI/API)

```powershell
npm run build --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
npm run prisma:generate
```

`@raptix/streaming` và `@raptix/web-contracts` export `dist/`; thiếu bước này
UI/server sẽ không resolve.

### 1.4 Tạo database riêng và migrate

DB của web tách khỏi DB khác: `raptix_web_raptix`.

```powershell
make webraptix-db-ensure
```

Sau đó apply migration (API container thường tự `prisma migrate deploy`; ở dev server
host phải chạy tay):

```powershell
# DATABASE_URL phải trỏ host PostgreSQL (5433) và db raptix_web_raptix
$env:DATABASE_URL = "postgresql://raptix:<POSTGRES_PASSWORD>@127.0.0.1:5433/raptix_web_raptix"
npm run prisma:migrate --workspace=@raptix/web-raptix-server
```

`<POSTGRES_PASSWORD>` lấy từ `.env` (`POSTGRES_PASSWORD=...`).

---

## 2. Khởi động API (terminal 1) — dev server

Server **KHÔNG tự đọc `.env`**. Phải export biến trong shell trước khi chạy.
Đọc các giá trị `POSTGRES_PASSWORD`, `NEO4J_PASSWORD`, `VAULT_ENCRYPTION_KEY`,
`RAPTIX_HOME` từ `.env`.

```powershell
# --- giá trị lấy từ .env ---
$env:DATABASE_URL                     = "postgresql://raptix:<POSTGRES_PASSWORD>@127.0.0.1:5433/raptix_web_raptix"
$env:WORKSPACE_PATH                   = "$env:RAPTIX_HOME\workspace"    # cùng dir langgraph mount
$env:RAPTIX_RUNTIME_WORKSPACE_ROOT    = "/workspace"                     # path trong container
$env:LANGGRAPH_API_URL                = "http://127.0.0.1:2400"
$env:NEO4J_HTTP_URI                   = "http://127.0.0.1:7475"
$env:NEO4J_USER                       = "neo4j"
$env:NEO4J_PASSWORD                   = "<NEO4J_PASSWORD>"
$env:VAULT_ENCRYPTION_KEY             = "<VAULT_ENCRYPTION_KEY>"
$env:HOST                             = "127.0.0.1"
$env:PORT                             = "5280"
$env:LOG_LEVEL                        = "info"

npm run dev:api
```

Kiểm tra API sống:

```powershell
curl.exe -s http://127.0.0.1:5280/api/health
curl.exe -s http://127.0.0.1:5280/api/health/ready
curl.exe -s http://127.0.0.1:5280/api/capabilities
```

Kỳ vọng: `capabilities` trả `mode: "local-single-user"`, và các mục
`agents`, `projects`, `planning`, `threads`, `runs`, `approvals`, `findings`,
`artifacts`, `graphs`, `timeline`, `reports`, `campaigns`, `vault`, `members`
ở trạng thái `available: true` (khi đủ DB + runtime + env). Riêng `c2` sẽ
`available: false` với lý do `provider_unavailable` khi chưa cấu hình Sliver
bridge (đúng, xem §6). `agents` cần LangGraph reachable; `timeline` cần runtime.

---

## 3. Khởi động UI (terminal 2) — dev server

```powershell
$env:VITE_DATA_MODE         = "real"                       # bắt buộc: real mode
$env:RAPTIX_WEB_BACKEND_URL = "http://127.0.0.1:5280"      # proxy /api
npm run dev --workspace=@raptix/web-raptix
```

Mở `http://127.0.0.1:5273`.

**Bằng chứng real mode.** Đáng tin nhất (không cần DevTools): gọi proxy trực tiếp từ UI port —

```powershell
(Invoke-WebRequest http://127.0.0.1:5273/api/engagements -UseBasicParsing).Content
# kỳ vọng: HTTP 200 + JSON list ([] khi chưa có engagement)
```

Bổ sung: DevTools → Network, reload `/` — phải thấy request `/api/engagements` (status 200).
Nếu không có request `/api/*` và vẫn thấy project mẫu (Acme/NovaPay/Alex Kim) → mock mode,
sửa `VITE_DATA_MODE`. Lưu ý: route là `/api/engagements`, không phải `/api/projects`.

---

## 4. Checklist test MANUAL theo từng trang

Với mỗi bước, "Đạt" nghĩa là **dữ liệu tới từ server thật**, không phải demo.

### 4.1 Engagement / Planning
- [ ] **Home `/projects`**: danh sách rỗng hoặc chỉ project đã tạo (không có fixture).
      Tạo project mới qua form (name slug, targetType, targetValue, xác nhận uỷ quyền).
      Reload → project còn nguyên.
- [ ] **Charter & ROE `/projects/:id/charter`**: 8 tài liệu planning với trạng thái
      ready/missing, đọc được nội dung.
- [ ] **Scope & Boundary `/projects/:id/scope`**: hiển thị scope/exclusion, có
      nút reload.

### 4.2 Execution
- [ ] **Operator Console `/projects/:id/console`**: New Chat → run planning thật
      (Soundwave). Thấy stream sự kiện, card OPERATOR/AGENT, kết thúc RUN SUCCESS.
      Reload giữa run → reconnect, không tạo run trùng. Reload sau khi xong → phục hồi
      timeline từ history.
- [ ] **Vector Campaigns / C2 & Sessions**: xem §6 (cần provider hoặc sẽ báo
      unavailable trung thực).

### 4.3 Infrastructure & Data
- [ ] **Infrastructure & Data `/projects/:id/infrastructure`**: đọc graph Neo4j;
      node detail đã redact credential-like.
- [ ] **Assets & Inventory `/projects/:id/assets`**: dẫn xuất từ cùng graph, dedupe host.
- [ ] **Credentials Vault `/projects/:id/credentials`**: store → list (không lộ plaintext)
      → reveal (audited, một lần) → revoke. Reload API → reveal lại cùng plaintext.

### 4.4 Outcomes
- [ ] **Findings & Evidence `/projects/:id/findings`**: parse `FIND-*.md` trong
      workspace; mở detail xem artifact preview.
- [ ] **Operations Log `/projects/:id/logs`**: timeline có nhãn nguồn
      `runtime`/`checkpoint`/`workspace`; filter theo payload.
- [ ] **Reports `/projects/:id/reports`**: preview từ DTO thật; export JSON & Markdown
      tải file thật (kiểm tra `Content-Disposition`).

### 4.5 Quản trị
- [ ] **Members `/projects/:id/members`**: đúng một operator row; invite/RBAC báo
      stated-absent (không có hàng Owner/Viewer giả).
- [ ] **Settings `/projects/:id/settings`**: save field đã persist → reload giữ giá trị;
      target-change chỉ draft; danger delete từ chối khi còn run hold.

**Điều kiện Đạt chung:** không trang nào render fixture khi real mode; mọi trang
`unavailable` phải nêu lý do rõ ràng, không báo thành công giả.

---

## 5. Lane test TỰ ĐỘNG (cho agent con tự chạy)

Thứ tự từ rẻ → đắt. Ghi lại command + kết quả + exit code làm evidence.

### 5.1 Deterministic (không cần backend chạy)

```powershell
# Shared contracts + streaming
npm run test --workspace=@raptix/web-contracts
npm run test --workspace=@raptix/streaming

# Server unit/integration (không cần DB; Prisma generate trước)
npm run prisma:generate
npm run test --workspace=@raptix/web-raptix-server

# UI unit
npm run test --workspace=@raptix/web-raptix

# Typecheck + lint + build (build đã chain typecheck)
npm run typecheck --workspace=@raptix/web-raptix
npm run lint      --workspace=@raptix/web-raptix
npm run build     --workspace=@raptix/web-raptix
```

Hoặc gọn: `make webraptix-quality`.

### 5.2 Mock E2E (production preview, không backend, không intercept API)

```powershell
npm run test:e2e --workspace=@raptix/web-raptix
```

Kỳ vọng: 13-tab navigation, source demo behavior. Đây là regression UI, **không phải**
bằng chứng real mode.

### 5.3 Real-mode fixture lane (UI + contracts, không full-stack)

```powershell
npm run test:e2e:real --workspace=@raptix/web-raptix
```

Lane này dùng `page.route()` fixtures cho một số spec — chấp nhận như bằng chứng
UI/contract, **không** gọi là full-stack.

### 5.4 Live verifier scripts (cần core stack + DB)

Các script trong `apps/web/tools/` spawn server thật trên port riêng và kiểm tra
từng nhóm. Chạy khi core stack đang lên:

```powershell
node apps/web/tools/verify-w06-live.mjs     # runtime context/catalog
node apps/web/tools/verify-w07-live.mjs     # runs/threads
node apps/web/tools/verify-iw07-live.mjs    # independence live
```

> Một số script cần env/DB riêng của gate gốc; nếu thiếu điều kiện, chúng phải **fail
> rõ ràng**, không được báo pass giả. Đọc đầu file `.mjs` để biết biến cần set.

### 5.5 Vault live (tuỳ chọn)

```powershell
node apps/web/tools/configure-local-vault-key.mjs    # giữ key hợp lệ, không rotate
node apps/web/tools/verify-vault-deployed.mjs        # cần deployment Docker, không phải dev
```

---

## 6. Ma trận tính năng khi chạy dev single-user

| Trang | Cần gì thêm | Trạng thái mặc định dev |
|---|---|---|
| Home, Charter, Scope | PostgreSQL + workspace | available |
| Operator Console | LangGraph runtime + LLM (litellm) | available |
| Findings, Evidence | workspace + DB | available |
| Infrastructure, Assets | Neo4j + `NEO4J_PASSWORD` | available khi env set |
| Operations Log, Reports | runs + workspace | available |
| Credentials Vault | `VAULT_ENCRYPTION_KEY` hợp lệ | available khi key set |
| Members | — | available (single-user view) |
| Settings (metadata) | DB | available |
| Vector Campaigns | Provider GoPhish/evilginx cho generate/deploy | drafts available; generate/deploy `provider_unavailable` |
| C2 & Sessions | Sliver bridge (`SLIVER_*`) | `unavailable` (`provider_unavailable`) |
| Settings (integrations/notifications) | — | stated-absent (non-goal) |

**Non-goal (không test):** multi-user/RBAC, HITL approve/reject, hosted durability.

---

## 7. Quy trình gợi ý cho agent con tự test

1. Chạy §1 (prereq) và §5.1 (deterministic) — dừng nếu lane này đỏ.
2. Khởi động API §2 + UI §3; xác nhận real mode (§3 DevTools).
3. Chạy §5.2 và §5.3 (UI regression).
4. Chạy §5.4 live verifiers đang lên được; ghi rõ script nào bị skip vì thiếu env.
5. Đi §4 checklist bằng Playwright/DevTools nếu có thể; nếu không, ghi lại output
   `/api/*` thực tế làm bằng chứng.
6. Báo cáo theo bảng: hạng mục | command | kết quả | bằng chứng (path/log) | ghi chú gap.

**Luật bằng chứng:** không tuyên bố "pass" nếu chưa thực sự chạy; không coi health
200 là đã chạy inference/tool; không coi fixture/intercept là full-stack.

---

## 8. Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| UI hiện project mẫu, không có request `/api` | `VITE_DATA_MODE` không phải `real` | Export `VITE_DATA_MODE=real` rồi restart UI |
| API 500 `Missing required env` | Chưa export env (§2) | Export đủ biến trước `npm run dev:api` |
| `/api/capabilities` thiếu `graphs` | `NEO4J_PASSWORD`/`NEO4J_HTTP_URI` sai | Kiểm tra Neo4j health + env |
| Vault `configuration_missing` | `VAULT_ENCRYPTION_KEY` sai/thiếu (phải 32 byte base64) | Set đúng key, restart API |
| Run tạo nhưng file không thấy ở Findings | API và LangGraph không cùng workspace | Đồng bộ `WORKSPACE_PATH` = `<RAPTIX_HOME>\workspace` |
| `assistant not found` | `RAPTIX_RUNTIME_ASSISTANTS` không khớp catalog | Kiểm tra `/api/agents` và allowlist |

---

## 9. Tham chiếu

- `apps/web/AGENTS.md` — gate và quy ước UI.
- `docs/web-dashboard.md` — kiến trúc web-raptix, lệnh lifecycle.
- `apps/web/docs/integration/progress.md` — W00–W20.
- `apps/web/docs/integration/interactive-web-readiness-backlog.md` — IW backlog + evidence.
- `apps/web/server/.env.example` — biến env của API server.
- `apps/web/.env.example` — biến build-time của UI.

> Ghi chú: một số tài liệu integration còn nhắc đường dẫn cũ `clients/web-raptix` và
> `containers/web-raptix.Dockerfile`. Đường dẫn hiện tại là `apps/web` và
> `infra/containers/web-raptix*.Dockerfile`; dùng bảng trong file này làm chuẩn.
