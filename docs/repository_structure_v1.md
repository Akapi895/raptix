# Security Platform — Chốt cấu trúc repo và ranh giới backend

- **Ngày:** 20/09/2026.
- **Trạng thái:** chốt layout và ownership để triển khai; chưa phải mô tả code đã tồn tại.
- **Cơ sở:** kế hoạch migrate Strix/CyberStrikeAI và lựa chọn Go modular monolith đã được hấp thụ vào tài liệu này.
- **Phạm vi:** tập trung backend Go; frontend, content và deployment được đặt trong cùng repo để làm rõ ranh giới.

**Quyết định tổng thể: ngôn ngữ backend là Go, một module trong `backend/`, tổ chức code theo Bounded Context (DDD).** API, background jobs và các module dùng chung một PostgreSQL nhưng có ownership dữ liệu riêng. Eino, MCP, River và filesystem là các adapter; chúng không quyết định mô hình finding, evidence hoặc memory. Không có engine Python nào trong runtime đích — tinh hoa của Strix và CyberStrikeAI được dịch sang thành phần Go, không phải wrapper process.

Tại thời điểm đánh giá, `security-platform/` chỉ có tài liệu trong `docs/`. Cây bên dưới là **cấu trúc đích**, tạo package khi có implementation; không tạo sẵn toàn bộ folder rỗng.

## 1. Nguyên tắc phối hợp: “spawn linh hoạt nhưng có kế hoạch”

Thiết kế lõi agent kế thừa cách làm của Strix (spawn động, agent đẻ agent bất đồng bộ) nhưng giữ tính kỷ luật của CyberStrikeAI (Eino Plan-Execute / Supervisor có topology rõ ràng). Không chọn một trong hai: hệ thống **dựa trên Orchestrator-plan nhưng cho phép subagent chuyên sâu xin mở nhánh mới có kiểm soát**.

### 1.1. Vai trò của Eino

- **Eino là khung model/agent ở dưới, không phải người quyết định topology sản phẩm.** Nó cung cấp Plan/Execute/Replanner, Supervisor, chat-model adapter và streaming.
- `engine/llm/adapters/eino/` là nơi map contract model của Eino sang contract nghiệp vụ của hệ thống.
- **Không để type/topology của Eino lan sang evidence, findings, state hay reporting.**
- **Ranh giới Eino đã chốt:** adapter `engine/llm/adapters/eino/` **chỉ phục vụ model call và streaming**. Kế hoạch (plan/replan), checkpoint, retry và lifecycle do `engine/orchestrator` + `engine/runs` sở hữu. Không dùng workflow runtime của Eino làm vòng điều phối thứ hai — tránh hai vòng cùng quản lý một công việc.

### 1.2. Hai mức phối hợp

| Mức | Điều gì xảy ra | Ai sở hữu |
|---|---|---|
| **Kế hoạch (Plan)** | Orchestrator dựng kế hoạch công việc (theo profile/task/scope), chọn subagent phù hợp, chia task. | `engine/orchestrator` |
| **Spawn linh hoạt** | Một subagent chuyên sâu gặp vấn đề cần đào sâu hơn, gọi tool `request_subagent` để xin mở nhánh con. Orchestrator kiểm tra budget/scope/concurrency rồi mới quyết định. | `engine/agents` + `engine/orchestrator` |

Điểm khác biệt với Strix gốc: **việc đẻ subagent phải được duyệt bởi orchestrator theo ngân sách và scope**, không phải subagent tự ý đẻ không kiểm soát. Kết quả trả về có cấu trúc (finding/evidence refs), giống completion handoff của Strix.

### 1.3. Quy tắc khi triển khai spawn

- Một **execution attempt** bền vững được ghi trước khi goroutine chạy; nếu process chết, hệ thống biết có attempt `pending`.
- **Idempotency**: retry cùng yêu cầu spawn không tạo hai subagent.
- **Không giữ slot làm việc khi đang chờ**: subagent chờ kết quả của child không chiếm toàn bộ concurrency.
- Context của child gắn với run/lifecycle, không gắn timeout của tool call đẻ nhánh.
- Goroutine và cancel handle chỉ là runtime state; PostgreSQL giữ lifecycle bền vững.

### 1.4. Hợp nhất công việc và tránh trùng

Điều phối không chỉ là *tạo agent*; cần quy tắc *hợp nhất công việc* và tránh trùng lặp:

- **Cây agent và quan hệ phụ thuộc task là hai khái niệm riêng.** Cây agent (spawn/cha-con) là quan hệ giám sát. Phụ thuộc task (task A cần kết quả B) không bắt buộc đi theo cha-con — một task có thể phụ thuộc nhiều nhánh. `engine/runs` biểu diễn dependency task độc lập với cây spawn.
- **De-duplicate cơ hội (không phải invariant):** các task liên quan đến cùng một `hypothesis` (trong `workspace/assessment`) nên được hợp nhất opportunity khi có cùng mục đích và điều kiện kiểm tra; nhưng **hai task khác điều kiện (ví dụ cùng endpoint với hai tài khoản quyền khác nhau) vẫn có thể phục vụ kiểm chứng và không phải công việc trùng**. Chống trùng phải bảo toàn khả năng kiểm chứng.
- **Giao vs spawn (ưu tiên reuse, không đóng cứng):** ưu tiên giao task cho agent đang chạy khi còn năng lực xử lý và phù hợp scope/context; spawn mới khi cần capability khác, cần đào sâu độc lập, hoặc theo concurrency và budget.
- **Child trả kết quả một phần:** phân biệt **dependency bắt buộc** và **tùy chọn** trước khi parent tiếp tục. Parent chỉ tiếp tục khi đủ kết quả bắt buộc; khoảng trống tùy chọn được ghi nhận thành `hypothesis`/`coverage` chưa kết luận; không chờ vô hạn.
- **Mâu thuẫn kết luận:** hai verdict/finding mâu thuẫn được lưu kèm nhau trong `workspace/findings` (revision + evidence + ai review), không ghi đè lẫn nhau. Giữ lịch sử; **cho phép re-verification theo policy** và chuyển người review khi chưa giải quyết được — không bắt buộc mọi phân xử là một điểm chờ thủ công duy nhất.
- **Budget hết ≠ task hoàn thành:** trạng thái `budget_exhausted` khác `completed`; coverage/assessment ghi nhận việc chưa làm vì budget, không đánh dấu đã kiểm tra.

Các quy tắc trên là heuristic để tránh công việc trùng, **không phải invariant đóng cứng**; thuật toán scheduling chi tiết định nghĩa ở nơi khác, không trong file cấu trúc này.

## 2. Cây repo đã chốt

Quy ước:

- `[gen]`: output sinh từ contract/SQL, không sửa tay.
- `[sau MVP]`: vị trí dành cho extension đã xác định; chỉ tạo khi triển khai.

```text
security-platform/
├── README.md
├── Makefile
├── .gitignore
├── .github/
│   └── workflows/
│
├── backend/
│   ├── go.mod
│   ├── go.sum
│   ├── sqlc.yaml
│   ├── cmd/
│   │   ├── server/
│   │   │   └── main.go
│   │   ├── cli/
│   │   │   └── main.go          # CLI binary — client của server
│   │   └── migrate/
│   │       └── main.go
│   ├── internal/
│   │   ├── app/                 # composition root + wiring
│   │   ├── api/                 # transport: handler, middleware, sse (web)
│   │   │   ├── handlers/
│   │   │   ├── middleware/
│   │   │   └── sse/
│   │   ├── cli/                 # transport: client của server (scan, run, view, completions)
│   │   │   ├── scan/
│   │   │   ├── run/
│   │   │   ├── view/
│   │   │   └── completions/
│   │   ├── execution/            # Domain: quản lý invocation (dispatch, quyền, timeout/cancel)
│   │   │   ├── invocation/       # kiểm tra quyền, ghi trạng thái, dispatch, ghi nhận kết quả
│   │   │   ├── sandbox/          # môi trường cho capability cần sandbox (giới hạn tài nguyên/network)
│   │   │   ├── cancel/           # cancellation & reconciliation khi server chết
│   │   │   └── artifact/         # file làm việc & artifact đầu ra của tool
│   │   ├── engine/              # Domain: điều phối & AI
│   │   │   ├── orchestrator/
│   │   │   ├── runs/             # run/task/agent lifecycle + transition (owner)
│   │   │   ├── agents/           # profile, instance, session, conversation, snapshot
│   │   │   ├── memory/           # memory có lifecycle & quyền chia sẻ riêng
│   │   │   ├── llm/
│   │   │   │   └── adapters/
│   │   │   │       └── eino/
│   │   │   ├── contextbuild/
│   │   │   └── knowledge/
│   │   ├── tools/               # Domain: catalog, schema, registry + implementation/adapter capability
│   │   │   ├── registry/
│   │   │   ├── builtin/
│   │   │   ├── output/
│   │   │   ├── mcp/             # interface cắm nóng; chưa bật ở MVP
│   │   │   ├── guard/           # ToolGuard (khung interface; chưa bật ở MVP)
│   │   │   └── hitl/            # Human-in-the-loop (khung interface)
│   │   ├── workspace/           # Domain: tài sản phân tích
│   │   │   ├── assessment/       # asset, observation, hypothesis/opportunity, coverage
│   │   │   ├── evidence/
│   │   │   ├── verifier/        # kiểm chứng lại PoC
│   │   │   ├── findings/
│   │   │   └── reporting/
│   │   ├── platform/            # Domain: quản trị nền tảng
│   │   │   ├── projects/
│   │   │   ├── governance/      # RBAC, scope, approval
│   │   │   ├── vault/           # credential/session store (loginmethod, session, redact)
│   │   │   └── audit/
│   │   └── infrastructure/      # nhóm kỹ thuật dùng chung (không phải business domain)
│   │       ├── database/
│   │       │   ├── postgres/
│   │       │   └── filesystem/
│   │       └── jobs/            # River
│   ├── migrations/
│   ├── testdata/
│   └── tests/
│       ├── integration/
│       ├── contracts/
│       └── architecture/
│
├── content/                     # nội dung cấp cho agent
│   ├── agents/                  # profiles, prompts
│   │   ├── profiles/
│   │   └── prompts/
│   ├── skills/
│   ├── tools/                   # manifest, schema, sets
│   │   ├── manifests/
│   │   │   └── cve_search.yaml  # tool CVE online (NVD/OSV)
│   │   ├── schemas/
│   │   └── sets/
│   ├── resources/
│   ├── knowledge/
│   ├── runtimes/
│   ├── templates/
│   │   ├── reports/
│   │   └── findings/
│   └── policies/
│
├── configs/
│   └── app.example.yaml
│
├── contracts/
│   ├── openapi.yaml
│   ├── events/
│   └── manifests/
│
├── web/                         # React + TypeScript (UI)
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── src/
│   │   ├── app/
│   │   ├── features/
│   │   │   ├── projects/
│   │   │   ├── runs/
│   │   │   ├── agents/
│   │   │   ├── tools/
│   │   │   ├── evidence/
│   │   │   ├── findings/
│   │   │   ├── reports/
│   │   │   ├── approvals/
│   │   │   └── settings/
│   │   └── shared/
│   │       ├── api/
│   │       │   └── generated/  [gen]
│   │       ├── ui/
│   │       ├── auth/
│   │       └── events/          # SSE client
│   └── tests/
│       ├── component/
│       └── e2e/
│
├── containers/
│   ├── app/
│   │   └── Dockerfile
│   └── sandbox/                    # image chạy tool (execution/sandbox điều khiển runtime)
│       └── Dockerfile
├── deploy/
│   └── compose.yaml
├── scripts/
├── evals/
│   ├── cases/
│   ├── fixtures/
│   └── baselines/
└── docs/
    ├── repository_structure.md
    ├── authoring/
    └── adr/
```

Backend chỉ có một `go.mod`; chưa cần `go.work`, module riêng cho mỗi feature hoặc `pkg/` công khai.

### 2.1. Stack V1 (tra cứu)

Lựa chọn kỹ thuật nền tảng, để tra cứu. Chi tiết router/frontend không cần diễn giải dài trong file cấu trúc.

| Phần | Lựa chọn | Ghi chú |
|---|---|---|
| HTTP | `net/http` + chi | REST, middleware, SSE; handler mỏng |
| Model integration | Go interface do ứng dụng sở hữu; adapter Eino khởi đầu | Không để type framework lan sang evidence/findings/storage |
| MCP | SDK Go chính thức | Client adapter trước; server adapter khi có consumer |
| Database | PostgreSQL + pgx | Transaction và trạng thái bền vững |
| SQL/migration | V1 dùng `sqlc` + goose | Muốn SQL và transaction tường minh; không phải lệnh cấm ORM vĩnh viễn |
| Background | River dùng chung PostgreSQL | Import/index/report; có thể cùng process |
| Artifact | Filesystem cho triển khai một máy | Chuyển shared/object storage khi execution hoặc artifact consumer phân tán; S3 là một lựa chọn, không phải hệ quả bắt buộc |
| Frontend | React + TS + Vite + React Router + TanStack Query | Dashboard nội bộ |
| Auth | OIDC + RBAC/membership backend | Session user ≠ credential connector |
| Log/test | slog, Go test, race, vet, govulncheck | Log có cấu trúc |

### 2.2. Glossary — phân biệt đối tượng

Các phân biệt ngăn nhầm lẫn khi triển khai:

- **Agent profile ≠ agent instance đang chạy.** Profile là mô tả vai trò; instance là một phiên cụ thể trong run.
- **Skill ≠ tool.** Skill là gói hướng dẫn đưa vào context; tool là capability thực thi.
- **Tool đã cài đặt ≠ agent được phép dùng.** Quyền thuộc `governance`; profile/persona không thay principal.
- **Knowledge retrieval ≠ instruction có thẩm quyền.** Tài liệu tham chiếu không tự thành chỉ thị.
- **Catalog ≠ điều phối.**
- **Định nghĩa capability ≠ quyền thực thi.** Tool tồn tại trong catalog không tự cấp quyền chạy; quyền thuộc `governance`, và việc chạy đi qua `execution`.

## 3. Ý nghĩa từng folder backend

Trong phần này, `internal/...` là viết gọn của `backend/internal/...`.

### 3.1. Entry point và application wiring

| Folder | Trách nhiệm |
|---|---|
| `backend/` | Một Go module chứa backend, migration, cấu hình sinh SQL và test kỹ thuật |
| `backend/cmd/` | Các chương trình có thể build/chạy; không đặt nghiệp vụ dùng chung tại đây |
| `backend/cmd/server/` | Nơi duy nhất chạy engine execution (agent loop) + HTTP/SSE + jobs: nạp cấu hình, gọi wiring, mở transport và jobs trong process, shutdown có kiểm soát. CLI và web đều là client của server này |
| `backend/cmd/cli/` | Entry point CLI: client của `cmd/server`. Gửi yêu cầu tạo/điều khiển run, stream tiến độ về terminal, xem report. Không tự host engine, không tồn tại run cục bộ |
| `backend/cmd/migrate/` | Entry point migration cho release (goose + River), dùng cùng cấu hình kết nối nhưng không khởi động API |
| `internal/` | Code riêng của backend. Quy tắc `internal` của Go hạn chế import từ bên ngoài; ranh giới giữa các bounded context vẫn cần test kiến trúc |
| `internal/app/` | Composition root: parse/validate cấu hình, tạo dependency, nối interface với adapter, đăng ký catalog/handler/worker, quản lý startup/shutdown |

`app/` là nơi lắp ráp, không phải nơi triển khai quy tắc severity, review hay retention. Migration chạy qua bước release riêng, không tự chạy ở mỗi lần HTTP server khởi động.

### 3.2. API và transport

| Folder | Trách nhiệm |
|---|---|
| `internal/api/` | Router `chi`, gắn transport với public service API, có thể phục vụ frontend build qua filesystem được cấu hình |
| `internal/api/handlers/` | Decode/validate HTTP request, gọi use case, map response/error |
| `internal/api/middleware/` | Request ID, session/principal, CSRF, giới hạn request, kiểm tra quyền ở transport boundary |
| `internal/api/sse/` | Phân phối tiến độ theo cursor; reconnect, heartbeat, snapshot fallback, lọc dữ liệu theo quyền |

Handler không import sqlc output hoặc truy vấn bảng trực tiếp. Kiểm tra quyền tại handler không thay kiểm tra ở service khi cùng use case được gọi từ job hoặc capability nội bộ.

### 3.2.1. Transport CLI — `internal/cli/`

CLI là transport thứ hai (ngoài HTTP/SSE) cho phép thao tác hệ thống từ terminal. **CLI là client của `cmd/server`** — engine execution (agent loop) chỉ chạy ở server, CLI và web cùng điều khiển/đọc **một `run_id` duy nhất** qua API. Không có chế độ CLI tự host engine hay run cục bộ.

| Folder/file | Trách nhiệm |
|---|---|
| `internal/cli/` | Điều phối lệnh CLI: parse flag (cobra/pflag), gọi API/server để tạo & điều khiển run, cấu hình/xem report, xuất output ra console |
| `internal/cli/scan/` | Lệnh chạy scan: gửi yêu cầu tạo run lên server, stream tiến độ về terminal (cùng event channel/cursor với SSE), hiển thị kết quả |
| `internal/cli/run/` | Lệnh điều khiển run đang chạy: continue, cancel, spawn/message, xem status — thông qua server |
| `internal/cli/view/` | Lệnh xem lại kết quả run/report đã lưu (đọc từ workspace/evidence, findings, reporting) |
| `internal/cli/completions/` | Sinh shell completions (zsh/bash/fish) |

**Nguyên tắc:**

- `internal/cli` **không chứa nghiệp vụ engine và không tự host engine**; nó là client gọi API của `cmd/server`. Không có logic phân tích trong CLI, không có agent runtime riêng.
- **CLI cần server đang chạy để scan** — không có chế độ offline. Nếu sau này cần offline thì là extension riêng, không nằm trong mô hình dùng chung run với web.
- **State bền vững là nguồn thật duy nhất:** run/task/agent lifecycle, conversation, evidence, findings nằm ở PostgreSQL + artifact store (qua `workspace`). CLI và web cùng đọc state qua API; không có bản copy riêng.
- **Continue từ CLI → web:** vì engine host giữ runtime, người dùng chỉ cần mở cùng `run_id` trên web (SSE hiển thị tiến độ live) và gửi lệnh điều khiển về server — không di chuyển process, không mất state.
- **SSE cho tiến độ, HTTP cho điều khiển:** tiến độ/live status nhận qua SSE (hoặc stream tương đương cho CLI); lệnh điều khiển (continue, cancel, spawn) gửi qua HTTP. Web dùng SSE; CLI stream qua cùng event channel/cursor để cả hai thấy trạng thái live của cùng một run.
- Xử lý quyền/scope giống nhau: CLI và web cùng đi qua `platform/governance`; khi cần credential grey-box, vẫn qua `platform/vault` + `governance`.
- CLI xuất output cho con người (bảng/thống kê) và hỗ trợ `--json` cho automation; completions đi qua `internal/cli/completions`.

**Ví dụ luồng web–CLI dùng chung một run (continue):**

```text
CLI:  security run scan --target <t> --scope <s>
   → gửi yêu cầu tạo run lên cmd/server → server trả run_id
   → server chạy engine (agent loop) → CLI stream tiến độ về terminal
Web:  user mở /runs/<run_id> → SSE hiển thị tiến độ live của chính run đó
Web:  user bấm "continue"/"add agent" → gửi lệnh về server → agent loop tiếp tục
CLI:  quay lại liệt kê/điều khiển cùng run qua `security run <run_id> ...`
```

### 3.3. Domain `engine` — điều phối và AI

Lớp chứa vòng đời agent, model và context. Đây là nơi kế thừa “spawn linh hoạt nhưng có kế hoạch”.

| Package | Trách nhiệm | Ranh giới quan trọng |
|---|---|---|
| `engine/orchestrator/` | Lập kế hoạch (plan), chọn subagent, chia task; duyệt yêu cầu spawn/subagent theo budget, scope và concurrency | Không giữ state bền vững riêng; không chứa parser/report template |
| `engine/runs/` | **Sở hữu run/task/agent lifecycle + transition** (ai cho task chạy, chuyển paused/cancelled/completed, xử lý child fail, retry/unknown); sở hữu repository contract | Không tự chạy tool hay render report; PostgreSQL là implementation lưu trữ |
| `engine/agents/` | Nạp profile, chuẩn bị agent instance/session, quản lý conversation và immutable content/capability snapshot; **sở hữu agent loop và thực hiện agent attempt** — dựng context (dùng `contextbuild`), gọi model (dùng `llm` adapter), yêu cầu capability qua `execution`, nhận kết quả, tiếp tục hoặc kết thúc; yêu cầu chuyển trạng thái qua `engine/runs` | Không tự quyết định quyền; không là nơi ghi status thứ hai |
| `engine/memory/` | Memory phục vụ các lần reasoning sau: namespace, source refs, expiry, quyền chia sẻ, cơ chế vô hiệu hoá nội dung sai | Không là raw evidence hay finding đã xác nhận; riêng khỏi conversation |
| `engine/llm/` | Contract Go cho model request/response/streaming/structured output/usage | Type Eino/provider không xuất hiện trong entity nghiệp vụ |
| `engine/llm/adapters/eino/` | Map model/streaming của Eino sang contract nghiệp vụ | Không để topology Eino là mô hình run/task của sản phẩm |
| `engine/contextbuild/` | Ghép prompt, skill đã chọn, memory và evidence references thành context có ngân sách và provenance | Dùng dữ liệu đã được cấp quyền; không sửa raw evidence |
| `engine/knowledge/` | Nạp, index, tìm kiếm tài liệu theo nguồn/project và version | Tài liệu là tham chiếu, không mặc nhiên là instruction |

**Chốt ownership trong engine:** ba vai trò tách bạch — `orchestrator` phân công công việc và điều chỉnh kế hoạch; `agents` thực hiện vòng làm việc của từng agent (agent loop + agent attempt) dùng `contextbuild`/`llm`/`execution`; `runs` kiểm soát và lưu các transition hợp lệ (gọi qua service, không import ngược). `memory` tách riêng khỏi `agents`. Không duy trì ba bản status đồng cấp. `cmd/server` host agent loop là quyết định về nơi chạy process; nó không thay thế việc chỉ định `engine/agents` sở hữu logic.

**Phân biệt attempt:** *agent attempt* (một lần agent làm việc), *tool invocation* (một lần công cụ tác động môi trường), *queue attempt* (một lần worker nhận job). Retry queue không được mặc nhiên tạo lại tool invocation; nếu tác động đã xảy ra nhưng chưa ghi nhận kết quả, cần trạng thái `unknown` và đối soát trước khi chạy lại.

### 3.3.1. Cấp năng lực cho agent: Requested / Available / Granted

Ba góc nhìn khi cấp năng lực, nối `profile → catalog → governance → runtime`:

| Khái niệm | Câu hỏi chính | Owner phù hợp |
|---|---|---|
| **Requested** | Task/profile muốn dùng gì? | `engine/agents`, `engine/orchestrator` |
| **Available** | Có implementation, version và dependency phù hợp không? | `tools/registry` + `execution` |
| **Granted** | Instance được phép dùng gì trong phạm vi nào? | `platform/governance` |

Nguyên tắc:

- **Snapshot ghi nhận đã resolve/cấp tại một thời điểm; không thay thế kiểm tra quyền hiện tại.** Thu hồi quyền, scope hết hạn hoặc hủy run vẫn phải có hiệu lực.
- **Available có thể thay đổi khi đang chạy.** Tool có trong catalog nhưng sandbox khởi tạo thất bại hoặc MCP mất kết nối vẫn có thể không dùng được.
- Không gom skill, tool, resource thành một loại quyền duy nhất. Chọn skill để đưa vào context **không tự cấp quyền chạy** tool được nhắc trong skill.
- Nạp skill hai mức: metadata trước, nội dung khi chọn; nội dung thực tế đã nạp được gắn version/hash để truy lại.

### 3.4. Domain `tools` — catalog, schema, registry và implementation/adapter

`tools` giữ catalog, schema, registry và **implementation/adapter của capability** (builtin, command, MCP). Nó trả lời *có năng lực gì* và *gọi implementation thế nào*. Việc **điều phối invocation** (kiểm quyền, dispatch, timeout/cancel, ghi kết quả) thuộc `execution` — xem 3.5.

| Package | Trách nhiệm |
|---|---|
| `tools/registry/` | Ánh xạ tool ID/version → implementation đã đăng ký; báo available/compatibility |
| `tools/builtin/` | Implementation capability tích hợp trong ứng dụng (đọc artifact được cấp, ghi finding draft, `with_credentials`/`get_session`, `cve_search`…); gọi service thay vì ghi DB trực tiếp |
| `tools/output/` | **Sở hữu result envelope và contract** (trạng thái partial/error/timeout, parse diagnostics, raw/structured refs); không nhất thiết là kho dữ liệu riêng |
| `tools/mcp/` | Adapter MCP (client dùng SDK Go chính thức) như một loại implementation capability; **chưa bật external MCP server vào MVP** |
| `tools/guard/` | **ToolGuard (khung).** Interface kiểm tra/ngăn lệnh nguy hiểm; bật policy khi cần |
| `tools/hitl/` | **Human-in-the-loop (khung).** Interface chờ người duyệt trước lệnh nhạy cảm; attach middleware khi cần |

**Cách dùng ở MVP:** đăng ký tool qua `registry`; `guard` và `hitl` chỉ là interface và middleware-stub, inject ở `app/` khi cấu hình bật.

**Luồng chung:** agent gửi yêu cầu (qua capability) → **`execution`** kiểm quyền, ghi trạng thái, **dispatch tới builtin/command/MCP adapter** phù hợp → timeout/cancel → ghi nhận kết quả về `tools/output`. Capability đọc artifact không cần container, nhưng vẫn đi qua `execution` để kiểm quyền và ghi invocation. **Verifier kiểm tra chủ động cũng đi qua đường này** (không tự chạy process hoặc gọi MCP trực tiếp ngoài execution).

**Phân định Governance / Execution / HITL:**
- **`platform/governance`** sở hữu *logic quyết định* cấp quyền và approval (scope, grant, policy).
- **`execution`** kiểm tra hiệu lực quyền tại thời điểm dispatch và không tự cấp quyền.
- **`tools/hitl`** quản lý việc *chờ và nhận phê duyệt* khi policy yêu cầu.
- **Kiểm soát bắt buộc của execution** (scope, grant, budget, trạng thái hủy) có từ lát cắt execution đầu tiên; **tính năng policy/HITL mở rộng** có thể sau. Hành động cần approval nhưng chưa có cơ chế duyệt thì **chưa được dispatch**.

**Credential và CVE qua tool:** tool `with_credentials`/`get_session` xin credential từ `platform/vault` qua interface (chỉ dùng trong scope đã cấp, redact mặc định). Tool `cve_search` gọi nguồn CVE online (NVD/OSV), kết quả được lưu kèm evidence và map vào asset/finding.

#### 3.4.1. Ba biểu diễn của tool output

Một tool call có ba biểu diễn với vai trò riêng — phân biệt contract và nơi lưu:

| Biểu diễn | Trách nhiệm |
|---|---|
| Raw artifact | `workspace/evidence` quản lý bytes/ref, provenance, quyền đọc |
| Structured result | Parser tạo dữ liệu theo schema; lưu dưới dạng **derived artifact qua evidence** khi cần truy lại |
| Context view | `engine/contextbuild` chọn lọc/tóm tắt để đưa vào model |

- `tools/output` sở hữu **result envelope và contract**, không nhất thiết là kho dữ liệu riêng. Observation được chấp nhận vào mô hình phân tích vẫn thuộc `workspace/assessment`.
- **Structured result** ghi raw artifact ref, parser version và parse status; **context view** ghi nguồn dữ liệu đã sử dụng.
- **Parser lỗi không đồng nghĩa không có finding.** Kể cả parse thành công và trả danh sách rỗng cũng chỉ chứng minh công cụ không báo kết quả trong lần chạy đó, không tự chứng minh mục tiêu không có vấn đề.

### 3.5. Domain `execution` — quản lý invocation

Lớp chịu trách nhiệm **điều phối invocation**: kiểm quyền, ghi trạng thái, dispatch tới implementation capability, timeout/cancel và ghi nhận kết quả. `tools/` cung cấp catalog, schema, registry và implementation; `execution/` quản lý vòng gọi thực tế và tác động tới môi trường.

| Package | Trách nhiệm |
|---|---|
| `execution/invocation/` | Điều phối một invocation: kiểm quyền, ghi trạng thái, **dispatch tới implementation capability** (builtin/command/MCP), timeout/cancel, ghi nhận kết quả về `tools/output` |
| `execution/sandbox/` | Quản lý môi trường cho **những capability cần sandbox**; giới hạn tài nguyên và đường ra mạng; lifecycle môi trường — không phải mọi invocation đều chạy trong sandbox |
| `execution/cancel/` | Cancellation và reconciliation: quản lý dừng tool khi run bị hủy, reconcile khi server chết nhưng công cụ còn chạy |
| `execution/artifact/` | File làm việc và artifact đầu ra của tool; phối hợp ghi qua `workspace/evidence` |

**Nguyên tắc:**
- Một invocation xác định rõ bởi `execution`; `execution/cancel` bảo đảm việc dừng và trạng thái `unknown` khi tác động đã xảy ra nhưng chưa rõ kết quả.
- `execution` **dispatch tới implementation** (do `tools` cung cấp); `tools` không tự chạy ngoài `execution`.
- Sandbox chỉ áp dụng cho capability cần môi trường sandbox; không đồng nghĩa ranh giới an toàn tuyệt đối. `containers/` build image sandbox, `execution/sandbox` điều khiển runtime.
- **"Không có engine Python" không đồng nghĩa phải viết lại mọi tool/script bảo mật sang Go** — tool bên ngoài là implementation được dispatch qua `execution` (process/command) hoặc adapter.
- **Verifier kiểm tra chủ động cũng đi qua `execution`** (không tự chạy process/gọi MCP trực tiếp), tránh tạo đường thực thi riêng.

### 3.6. Domain `workspace` — tài sản phân tích

Lớp chứa dữ liệu kết quả của quá trình phân tích. **Lifecycle run/task/agent không nằm ở đây** (đã chuyển sang `engine/runs/`); workspace giữ nội dung phân tích.

| Package | Trách nhiệm | Dữ liệu/đầu ra chính |
|---|---|---|
| `workspace/assessment/` | Mô hình bề mặt tấn công: asset, observation, hypothesis/opportunity, coverage | Biểu diễn "đã phát hiện gì, giả thuyết gì, đã thử gì, còn cơ hội nào"; phân biệt đã thử/không thực hiện được/không phát hiện/đã kiểm chứng âm tính |
| `workspace/evidence/` | Đăng ký artifact, lifecycle lưu trữ, provenance, checksum, sensitivity, quan hệ raw/derived | Metadata trong PostgreSQL; bytes qua storage adapter |
| `workspace/verifier/` | Kiểm chứng theo tiêu chí từng loại kết luận (không chỉ re-run PoC): đọc finding draft + evidence, thực hiện kiểm chứng cần thiết qua `execution`, trả verdict có lý do và evidence mới | Verdict (confirmed/refuted/inconclusive) + evidence refs; **không tự đổi finding status** |
| `workspace/findings/` | Finding aggregate, severity/confidence, revision, evidence links, review history | Draft → reviewed → confirmed/rejected/inconclusive theo quy tắc nghiệp vụ; verification không tự đổi status |
| `workspace/reporting/` | Chụp dữ liệu đầu vào, quản lý report request, render và xuất bản | Immutable snapshot, template version, report artifact reference |

**Chốt assessment:** phân biệt `asset` (host/service/endpoint), `observation` (phản hồi thực tế), `hypothesis`/`opportunity` (hướng kiểm tra có căn cứ, chưa xác nhận), `coverage` (đã kiểm tra gì, phương pháp, kết quả, giới hạn). Khả năng mở rộng sang network quyết định bởi việc mô hình này biểu diễn được miền mới mà không ép mọi thứ thành URL/HTTP.

**Chốt verification:** `workspace/verifier` trả verdict cho `workspace/findings`; **`findings` là owner duy nhất** của status transition — không có hai nơi đổi status. Verifier định nghĩa theo *tiêu chí kiểm chứng từng loại kết luận*; một lần chạy lại thất bại có thể do môi trường thay đổi/credential hết hạn/thiếu điều kiện, chưa đủ kết luận `refuted`. Verdict gắn với finding revision, điều kiện kiểm tra và evidence.

### 3.7. Domain `platform` — quản trị nền tảng

| Package | Trách nhiệm |
|---|---|
| `platform/projects/` | Project metadata, lifecycle, membership, scope version |
| `platform/governance/` | Roles/permissions, scope, approval, capability grant; dùng identity và membership để đánh giá quyền |
| `platform/vault/` | Credential/session store cho grey-box: `LoginMethod` pluggable (otp, user:pass, oauth…), `session` (cookie/header/token) có lifecycle (hết hạn → renew), `redact` mặc định lưu `session_ref` |
| `platform/audit/` | Audit record (actor/action/resource/outcome/reason/correlation), truy vấn, retention |

Profile agent (content) khác role quyền truy cập (governance).

### 3.7.1. Grey-box: `platform/vault` (credential/session store)

Vault quản lý vòng đời credential dùng cho scan grey-box. Nguyên tắc theo thiết kế đã chốt:

- **Nhiều loại login và lưu trữ**: interface `LoginMethod` pluggable (OTP, username:password, OAuth…) sinh `StoredSession` (cookie, header, token…). Thêm dạng login mới bằng cách thêm implementation vào `platform/` + manifest, không sửa luồng tool call.
- **Agent tự chủ có kiểm soát**: agent có thể tự login / tự renew khi session hết hạn, nhưng mọi thao tác ghi/sửa/renew đều **đi qua capability grant** (`platform/governance`) và **có audit** (`platform/audit`). Agent không sở hữu credential bất biến theo ý muốn.
- **Credential cấp qua tool**: agent gọi tool `with_credentials` / `get_session` để lấy session phục vụ request trong scope đã cấp. `engine` và `tools` gọi `platform/vault` **qua interface**, không import trực tiếp bảng vault.
- **Redact mặc định**: credential/session không xuất hiện trong log, context dài hạn hoặc evidence; chỉ lưu `session_ref` để truy nguyên. Bytes secret nằm trong vault, không trong evidence.

Chiều dependency: `engine/agents` và `tools` xin credential qua interface; `platform/vault` sở hữu bảng credential/session riêng.

### 3.7.2. RBAC / scope / audit (nguyên tắc)

- **Governance sở hữu logic quyết định** (ai được cấp quyền gì, approval, policy); **`execution` kiểm tra hiệu lực quyền tại thời điểm dispatch** và không tự cấp quyền. Phân biệt *ai quyết định* với *lúc nào quyết định được đánh giá* — quyền bị thu hồi, scope hết hạn hoặc hủy run phải có hiệu lực tại thời điểm dispatch.
- **Persona không thay principal.** Agent có role chuyên môn (recon, reviewer) không mặc nhiên có quyền của người dùng mang cùng tên role.
- **Backend authorization:** roles + project membership + resource permission, kiểm tra ở backend; UI ẩn nút không thay server-side authorization.
- **Scope:** version, loại asset, include/exclude, thời hạn, nguồn phê duyệt; asset mới không tự mở scope.
- **Secrets:** secret reference thay giá trị trong manifest; redact khỏi log/report/context khi không cần.
- **Audit:** actor/action/resource/outcome/reason/time/correlation; ghi cả quyết định cấp/từ chối.

**Ma trận quyền dự kiến** (điểm khởi đầu, không chốt cứng): cần phân biệt các quyền *quản trị project*, *khởi chạy/điều khiển run*, *review finding*, *phê duyệt hành động cần approval*. Không mặc nhiên coi Reviewer là người được duyệt mọi hành động của agent — ma trận chi tiết để ở `contracts/`/policy.

### 3.8. Nhóm kỹ thuật dùng chung (không phải business domain)

`infrastructure/` là **nhóm hạ tầng kỹ thuật dùng chung**, không phải một bounded context nghiệp vụ theo nghĩa DDD. Nó chứa adapter lưu trữ và background job.

| Package | Trách nhiệm |
|---|---|
| `infrastructure/database/` | Namespace cho adapter lưu trữ dùng chung; không chứa mọi repository nghiệp vụ |
| `infrastructure/database/postgres/` | Khởi tạo `pgxpool`, health check, transaction primitives; không sở hữu bảng finding/run/memory |
| `infrastructure/database/filesystem/` | Blob read/write, staging, promote, xóa object theo yêu cầu service; không tự quyết định quyền/retention |
| `infrastructure/jobs/` | River client/worker registration, job payload có version, retry/cancellation mapping; gọi public service của module |

Audit là lịch sử hành động nghiệp vụ; telemetry là chẩn đoán vận hành. Không dùng application log làm nguồn duy nhất để xác định finding đã review.

## 4. Ý nghĩa các folder ngoài backend

### 4.1. `content/` — nội dung cấp cho agent

Các folder cha `agents/`, `skills/`, `tools/`, `resources/`, `knowledge/`, `runtimes/`, `templates/`, `policies/` là nhóm content. Backend load từ content root được cấu hình, không phụ thuộc thư mục hiện hành khi chạy binary. Bản release phải đóng gói content được tham chiếu; snapshot đã dùng phải đọc lại được dù content root được nâng cấp.

| Folder | Ý nghĩa |
|---|---|
| `content/agents/profiles/` | Profile agent: ID/version, prompt refs, skill/tool/resource yêu cầu, model preference |
| `content/agents/prompts/` | Prompt fragments, có version/hash trong snapshot |
| `content/skills/` | Gói hướng dẫn theo nhiệm vụ (SKILL.md + references) |
| `content/tools/manifests/` | Manifest tool: input/output schema, executor = builtin/command/mcp, runtime requirements, source ref |
| `content/tools/manifests/cve_search.yaml` | Tool CVE online (NVD/OSV): tra cứu CVE theo thành phần/version, có source ref; kết quả map vào asset/finding |
| `content/tools/schemas/` | Input/output JSON Schema của từng capability |
| `content/tools/sets/` | Nhóm tool tham chiếu bằng ID/version để profile yêu cầu |
| `content/resources/` | Manifest resource pack: source, license, digest, size, format, reference |
| `content/knowledge/` | Tài liệu tham chiếu cho retrieval |
| `content/runtimes/` | Runtime profile và inventory môi trường |
| `content/templates/reports/`, `content/templates/findings/` | Template trình bày; không định nghĩa finding lifecycle |
| `content/policies/` | Policy mẫu; policy có hiệu lực là cấu hình được quản lý ở backend |

**Tool manifest không tự thực thi:** đọc manifest không load code hoặc chạy shell. Adapter Go được đăng ký tường minh ở `app/`. Capability được cấp do `platform/governance`, không phải vì manifest tồn tại.

### 4.2. `contracts/` và `web/`

| Folder/file | Ý nghĩa |
|---|---|
| `contracts/` | Nguồn contract versioned cho boundary ngoài/module content; không phải nơi gom mọi interface Go |
| `contracts/openapi.yaml` | REST contract, sinh backend transport types và frontend client |
| `contracts/events/` | Schema/version của event envelope và payload cho UI qua SSE |
| `contracts/manifests/` | JSON Schema cho profile, skill metadata, tool manifest, resource manifest, runtime profile |
| `web/` | React/TypeScript/Vite, lockfile độc lập với Go module; UI tối thiểu theo lát cắt backend |
| `web/src/shared/events/` | SSE client, reconnect/cursor, đồng bộ cache TanStack Query |

**API & UI:** `repository_structure.md` chỉ mô tả **nhóm tính năng** và module liên quan. Endpoint/request/response/lỗi/pagination/quyền chi tiết định nghĩa trong `contracts/openapi.yaml` (nguồn contract duy nhất, sinh client + kiểm tra handler). Nhóm tính năng chính: project, run, agent inspector, skills, tools, evidence, findings, reports, approvals, settings. Các màn hình catalog/inspector đầy đủ có thể triển khai sau lát cắt chạy tool đầu tiên.

**ADR:** quyết định kiến trúc có trade-off được ghi ở `docs/adr/`; mỗi ADR mô tả lựa chọn và hệ quả. File cấu trúc không chép một ADR cho từng thư viện mà dẫn tới thư mục `docs/adr/`.

### 4.3. Build, deployment và tài liệu

| Folder/file | Ý nghĩa |
|---|---|
| `configs/app.example.yaml` | Cấu hình mẫu có giải thích; secret nằm ngoài source |
| `containers/app/Dockerfile` | Đóng gói Go binary, frontend build, content cần thiết |
| `containers/sandbox/Dockerfile` | Image chạy tool; `execution/sandbox` điều khiển runtime, giới hạn tài nguyên/network |
| `deploy/compose.yaml` | Topology MVP: app + PostgreSQL + artifact volume |
| `scripts/` | Automation mỏng cho build/generate/check/package |
| `.github/workflows/` | CI cho code, contracts, content validation, release |
| `evals/` | cases/fixtures/baselines + runner/oracle/lab reset để đo task success, false positives, chi phí |
| `docs/` | Thiết kế hệ thống, authoring, ADR |

## 5. Cấu trúc bên trong một package Go (module nhỏ)

Package nhỏ dùng cấu trúc phẳng. Ví dụ `workspace/findings` khi đã có persistence:

```text
backend/internal/workspace/findings/
├── types.go
├── service.go
├── repository.go        # interface persistence do chính module sở hữu
├── postgres.go
├── service_test.go
├── postgres_test.go
├── queries/             # SQL của module
│   └── findings.sql
├── storegen/            [gen]
└── testdata/
```

**Quy tắc dữ liệu:**

1. `backend/migrations/` giữ một thứ tự migration toàn ứng dụng; tên migration thể hiện domain sở hữu thay đổi.
2. `sqlc.yaml` cấu hình output riêng cho từng module; không có một generated package chứa toàn bộ query.
3. Cross-module use case gọi public service API; không SQL join tùy tiện trong handler/report template.
4. Thao tác nhiều module cần atomicity phải có transaction boundary tường minh.
5. Report request, snapshot reference và River enqueue dùng cùng transaction PostgreSQL.
6. Trạng thái/revision có kiểm tra version khi cập nhật.

Không bắt buộc mỗi package có `domain/`, `application/`, `infrastructure/`, `ports/`, `adapters/`. Chỉ tách sâu khi package thực sự lớn hoặc có nhiều implementation. File không phải ranh giới import của Go; giữ repository interface không export khi phù hợp; test kiến trúc kiểm tra cả import lẫn việc gọi constructor/adapter từ nơi không được phép.

## 6. Dependency và data ownership bắt buộc

### 6.1. Chiều dependency

```text
  cmd/cli  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  (client, không host engine)
     │                                                                    │
     ▼  HTTPS/WS                                                          │
  ┌────────────────────────────── cmd/server (sole engine host) ────────┐│
  │   app (composition root)                                            ││
  │    ├── api (HTTP/SSE) ── web client                                 ││
  │    ├── engine execution (agent loop)  ◄──/runs/<id>/events──────────┼┘
  │    └── jobs (River)                                                 
  └──────────────────────────────────────────┬───────────────────────────┘
                                             ▼
   API  ──►  public service / use case    engine, execution, workspace, platform
                                             │
                                             ▼
                                   contract do nơi dùng sở hữu
                                             ▲
                                             │ implements
                                   adapter cụ thể   PostgreSQL, filesystem, Eino, MCP
```

Ký hiệu: khung `cmd/server` là một process backend **host agent loop** + HTTP/SSE + jobs; vẫn có thể có process/container công cụ (sandbox) bên ngoài. `cmd/cli` là client gọi API của server; `cmd/migrate` chỉ dùng nhánh migration/storage, không mở `api`/engine/jobs.

- `app` được import service và adapter để wiring; module nghiệp vụ không import ngược `app`, `api` hoặc River workers.
- `internal/cli` gọi **server API** (qua client tới `cmd/server`); `internal/api` handler gọi **domain service** (qua `app` composition). Cả hai đều là transport mỏng: không chứa nghiệp vụ engine, không import sqlc/bảng trực tiếp. `cmd/cli` là client của `cmd/server`, không host engine.
- `engine` (điều phối/runs/agents) gọi `tools` qua contract, `tools` mô tả năng lực, `execution` thực thi; không import ngược để callback.
- `tools` không import ngược `engine/agents`; capability được inject qua interface. `execution` gọi implementation tool và map kết quả về `tools/output`.
- Parent domain định nghĩa contract không import implementation con làm dependency mặc định (ví dụ `engine/llm` không import `eino`; `app` inject Eino adapter).
- Không tạo `common`, `utils`, `interfaces` hoặc `models` thành nơi tập kết tùy ý.
- `engine/agents` không tự quyết định quyền; mọi access đi qua `platform/governance`.

### 6.2. Ai là nguồn dữ liệu chính?

| Dữ liệu | Owner | Quy tắc |
|---|---|---|
| User identity/session | `platform` (identity qua OIDC) | Project membership do `projects` quản lý |
| Scope/policy/grant/approval | `platform/governance` | Snapshot cũ không ghi đè việc thu hồi quyền hiện tại |
| Run/task/agent lifecycle & transition | `engine/runs` | PostgreSQL authoritative; `orchestrator` gọi service của `runs` để lập/thay đổi kế hoạch; event feed/snapshot là dữ liệu đọc cho UI |
| Tool invocation & sandbox | `execution` | Điều phối invocation (kiểm quyền, dispatch, timeout/cancel, ghi nhận kết quả về `tools/output`); sandbox chỉ áp dụng cho capability cần môi trường sandbox; reconcile khi server chết |
| Conversation/content snapshot | `engine/agents` | Conversation của agent; lưu version/hash/ref; không copy status để tự quản lý |
| Memory entry | `engine/memory` | Có namespace, source refs, expiry, quyền chia sẻ, vô hiệu hoá nội dung sai; không là raw evidence hay finding đã xác nhận |
| Asset / observation / hypothesis / coverage | `workspace/assessment` | Biểu diễn bề mặt tấn công; phân biệt đã thử/không thực hiện được/không phát hiện/đã kiểm chứng âm tính |
| Knowledge metadata/index | `engine/knowledge` | Có nguồn/version; chỉ mục có thể dựng lại |
| Artifact metadata/raw-derived relation | `workspace/evidence` | Binary bytes qua storage adapter |
| Assessment/review và finding revision | `workspace/findings` | `workspace/verifier` cung cấp verdict; reviewer/finding service quyết định transition |
| Verified verdict (kiểm chứng theo tiêu chí kết luận) | `workspace/verifier` | Trả verdict + evidence mới qua `execution`; không tự đổi status, `findings` là owner transition |
| Credential/session (cookie, header, token) | `platform/vault` | Agent dùng qua tool với grant từ `governance`; redact mặc định, lưu `session_ref` |
| Kết quả CVE search | `workspace/evidence` (lưu ref) + `workspace/findings` (map) | Tra cứu online qua tool; kết quả lưu kèm evidence và map vào asset/finding |
| Report request/snapshot/template version | `workspace/reporting` | Render đúng snapshot; revision mới tạo report mới |
| River execution/attempt | `infrastructure/jobs`/River | Không thay run status hoặc report business status |
| Audit record | `platform/audit` | Actor/action phải truy được tới request/run/resource |

Run/task/agent lifecycle nằm trong `engine/runs` (owner) để phân biệt rõ với `workspace` (nội dung phân tích) — `engine/runs` giữ transition bền vững, `workspace/assessment` giữ coverage/observation.

#### 6.2.1. Định nghĩa các loại dữ liệu cốt lõi

| Loại | Ý nghĩa | Ví dụ thông tin giữ |
|---|---|---|
| **State** | Công việc/phiên đang ở trạng thái nào | run/task/agent ID, status, version, quan hệ, thời điểm |
| **Memory** | Thông tin phục vụ reasoning lượt sau | nội dung, namespace, source refs, expiry, mức xác thực |
| **Evidence** | Căn cứ có nguồn gốc để kiểm tra | raw artifact, nguồn, checksum, schema/version, quyền đọc |
| **Coverage** | Xem xét tới đâu; phân biệt chưa làm/không kết luận | planned/reviewed/inconclusive/skipped, lý do, evidence refs |
| **Finding** | Kết luận được quản lý | draft/reviewed/confirmed/rejected, confidence, severity, review history |

- Namespace agent/run/project tách rõ. Chia sẻ memory không đồng nghĩa chia sẻ credential/raw output/quyền truy cập. Memory summary không thành verified fact chỉ vì nhiều agent lặp lại.
- Coverage record khác finding record: chưa có finding có thể do chưa làm, thiếu dữ liệu hoặc đánh giá chưa kết luận.

## 7. Transaction, artifact và report flow

Đây là luồng minh hoạ cho **transaction, artifact và report** dùng case **review artifact có sẵn** (một use case trong lát cắt 2, không đại diện toàn MVP — xem 9.2). Nó kiểm chứng các bước bền vững và provenance của dữ liệu:

1. API gọi `workspace/evidence` nhận artifact: **ghi staging → kiểm tra/checksum → đưa bytes tới vị trí bền vững → commit metadata `available` → dọn staging/orphan theo cơ chế đối soát**. Không đánh dấu `available` khi bytes chưa sẵn sàng.
2. `platform/governance` kiểm tra quyền; `engine/orchestrator` mở run review; `engine/agents` dựng profile/content/capability snapshot; `engine/runs` giữ lifecycle và transition.
3. `engine/contextbuild` tạo context có evidence references; adapter `engine/llm` trả structured draft; `workspace/findings` ghi draft với version dữ liệu đầu vào.
4. Reviewer thực hiện use case review; `workspace/findings` ghi assessment, reviewer, reason và transition trên đúng revision trong transaction.
5. `workspace/reporting` tạo request và snapshot nhất quán (finding revisions/evidence refs/template version).
6. Cùng transaction với report request, enqueue River job; worker render snapshot, đăng ký output qua evidence; chỉ đánh dấu completed khi artifact sẵn sàng.
7. UI lấy trạng thái từ API; SSE hỗ trợ cập nhật và reconnect.

Hệ quả triển khai:

- Snapshot report được đọc trong transaction có mức nhất quán phù hợp hoặc từ revisions đã chọn tường minh.
- Job idempotent theo report request ID/revision; queue retry không tạo report nghiệp vụ mới ngoài ý muốn.
- Go context cancellation thể hiện ý định hủy; completed/cancelled theo kết quả ghi nhận, không theo việc HTTP đã trả response.
- Không giữ DB transaction mở suốt model call hoặc ghi file lớn.
- Sau mất kết nối server, phân biệt rõ *server không phản hồi* với *trạng thái công việc thực*: đối soát execution (tool invocation/attempt) trước khi kết luận run đã kết thúc. Lifecycle ghi `interrupted`/`unknown` khi chưa có căn cứ hoàn tất; không coi mất kết nối là run đã dừng.

## 8. Run data và content release

Dữ liệu runtime nằm ngoài git, trong data root được cấu hình:

```text
<DATA_DIR>/
├── staging/
├── projects/
│   └── <project_id>/
│       ├── artifacts/          # nguồn import độc lập với run
│       └── reports/
└── runs/
    └── <run_id>/
        ├── snapshots/          # nội dung/config/template đã dùng
        ├── raw/                # byte gốc artifact
        ├── derived/            # structured result, summary có provenance
        ├── reports/
        └── scratch/            # dữ liệu tạm, lifecycle ngắn hơn evidence
```

- Đường dẫn là chi tiết filesystem adapter; nghiệp vụ tham chiếu artifact ID.
- Run workspace không phải database thứ hai; snapshot không ghi đè PostgreSQL state khi khởi động lại.
- Backup/restore xét metadata DB và artifact còn được tham chiếu như một bộ dữ liệu liên quan.

Release gồm binary/backend version, frontend build và content bundle có version/digest. Content root resolve ở `app`, không hard-code `../../skills`.

**Nguyên tắc hạ tầng V1:**
- Redis/Kafka/service mesh/graph DB/vector DB riêng/workflow editor **không đưa vào baseline V1**; bổ sung khi có nhu cầu và bằng chứng cụ thể.
- Không **replay hoạt động ngoài** chỉ vì job timeout; retry phải phân biệt model request, job và replay tool execution.
- Artifact file và DB không cùng một transaction; dùng các bước bền vững có trạng thái để thể hiện lỗi một phần.

## 9. Test, eval và mức triển khai ban đầu

### 9.1. Ý nghĩa folder kiểm chứng

| Folder | Dùng cho |
|---|---|
| `backend/internal/<module>/*_test.go` | Unit + repository test cạnh implementation |
| `backend/internal/<module>/testdata/` | Fixture riêng của module |
| `backend/testdata/` | Fixture kỹ thuật dùng chung |
| `backend/tests/integration/` | Luồng multi-module/PostgreSQL/artifact store, migration, River behavior |
| `backend/tests/contracts/` | REST/SSE/manifests/schema compatibility, mapping adapter |
| `backend/tests/architecture/` | Cấm import repository/sqlc của module khác; bảo vệ dependency direction, giới hạn SDK trong adapter |
| `evals/` | runner, oracle, lab reset + cases/fixtures/baselines | Đo **task success có oracle xác nhận**, execution (tool chạy đúng, evidence/observation đủ), false positives, công việc trùng, chi phí/thời gian — ngoài chất lượng context/draft/review |

Test kỹ thuật trả lời “implementation đúng contract không”; eval trả lời “kết quả có đủ căn cứ không”. Không dùng số agent/token/tool call thay cho chất lượng kết luận.

### 9.2. Thứ tự hiện thực hóa theo lát cắt

Tổ chức theo lát cắt để **kiểm chứng sớm luồng Red Team** (agent gọi tool → lưu bằng chứng → verifier → xử lý restart), thay vì hoàn thiện từng phần quản lý trước khi biết agent–tool–verifier phối hợp được hay không. "Review artifact có sẵn" là một **use case** trong lát cắt luồng hoàn chỉnh, không đại diện toàn MVP.

| Lát cắt | Nội dung | Tiêu chí hoàn thành |
|---|---|---|
| **1. Nền tối thiểu** | `app`, `api`, `platform` (projects, governance, audit), `infrastructure/database`, migration, `engine/runs` | Project/scope/run + persistence; migrate được; lifecycle run có transition cơ bản |
| **2. Một luồng hoàn chỉnh (lõi Red Team)** | `engine/agents` (agent loop), `engine/contextbuild`, `engine/llm`, một capability trong `tools`, `execution/invocation` + `execution/sandbox`, `workspace/evidence`, `workspace/assessment`, `workspace/verifier` | Lát cắt lab có ground truth: agent chọn task → gọi capability qua execution → sandbox → lưu evidence/observation → verifier đánh giá → draft. **Review artifact là một use case của lát cắt này** |
| **3. Độ tin cậy** | `execution/cancel`, `execution/artifact`, trạng thái `unknown`, tránh dispatch lặp | Cancel/restart đúng; invocation chưa rõ kết quả không dispatch lặp lại tool có side effect; reconcile khi server chết |
| **4. Mở rộng** | `engine/orchestrator` (nhiều agent, spawn), `engine/memory`, `engine/knowledge`, nhiều skill/tool, `workspace/reporting`, CLI, vault, CVE-search, UI inspector đầy đủ | Orchestration nhiều agent, memory/tri thức, reporting, inspector; grey-box credential, CVE |

Ghi chú lát cắt:
- `tools` (registry, builtin, output) và `execution` **triển khai cùng nhau** từ lát cắt 2 — capability cần execution để dispatch, execution cần capability để gọi.
- `workspace/verifier` xuất hiện ngay trong lát cắt 2 (sau execution) để kiểm chứng kết quả, không để muộn.
- `workspace/findings`/`reporting` đầy đủ, memory, orchestration là mở rộng (lát cắt 4).
- `evals/` (runner, oracle, lab reset) nên dựng từ lát cắt 2 để đo task success, false positives, chi phí trên lab có ground truth.

### 9.3. Các ca kiểm thử quan trọng của spawn

| Tình huống | Điều cần đúng |
|---|---|
| Cùng spawn request gửi lại | Chỉ một subagent |
| Hai request tranh slot cuối | Admission không vượt giới hạn |
| Subagent chờ children | Children vẫn có slot thực thi |
| Message tới agent đã kết thúc | Phản ánh khả năng nhận/xử lý thực tế (giống Strix non-interactive) |
| Crash sau commit trước wake-up | Pending work/message còn truy được |
| Hủy run | Subagents được reconcile, resource được thu hồi |

## 10. Bản đồ đọc code khi bắt đầu triển khai

1. `backend/cmd/server/` → `backend/internal/app/`: server host engine (agent loop) và API; nơi khởi động vận hành.
2. `backend/internal/api/`, `internal/cli/` → service: web (HTTP/SSE) và CLI (client của server) cùng điều khiển/đọc một run.
3. `backend/internal/engine/orchestrator/`, `engine/runs/`, `engine/agents/`: ai lập kế hoạch, ai giữ lifecycle, ai chuẩn bị session, ai duyệt spawn.
4. `backend/internal/engine/contextbuild/`, `engine/llm/`, `tools/`, `execution/`: context/capability/model → thực thi tool trong sandbox được nối thế nào.
5. `backend/internal/workspace/assessment/`, `evidence/`, `verifier/`, `findings/`, `reporting/`: bề mặt tấn công → dữ liệu nguồn → kiểm chứng PoC → kết luận và bản xuất.
6. `backend/internal/platform/vault/`, `governance/`, `audit/`: credential/session, quyền và lưu vết.
7. `backend/internal/infrastructure/database/`, `jobs/`, `migrations/`: công việc nền và dữ liệu bền vững.

**Tóm lại:** Go backend gom theo bounded context — `engine` điều phối và chạy model (spawn linh hoạt có kế hoạch, `engine/runs` giữ lifecycle); `execution` thực thi tool/sandbox; `tools` mô tả năng lực qua registry với khung MCP/Guard/HITL; `workspace` sở hữu assessment/evidence/verifier/findings/reporting; `platform` quản lý project/quyền/vault/audit; `infrastructure` phục vụ DB và jobs. `cmd/server` là **sole engine host** (agent loop + HTTP/SSE + jobs); `api` (web) và `cli` (terminal) là hai client cùng điều khiển và đọc một `run_id` qua API — chạy run trên CLI vẫn continue được trên web vì engine tập trung và state bền vững ở PostgreSQL/artifact store.
