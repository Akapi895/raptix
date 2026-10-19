# Thiết kế và implementation plan: project environment riêng, một project active

- **Ngày:** 2026-10-19.
- **Source baseline:** `2d4939f3435c374c3d2d94f06fc3a97c6f19ae7b`, branch `web-improve-refactor`, **cộng working tree đang được nhiều phiên chỉnh sửa**. Kiểm tra lại HEAD/diff trước implementation.
- **Trạng thái:** Proposed implementation design. Người yêu cầu đã chọn hướng isolation theo project và xác nhận chỉ chạy một project tại một thời điểm. Các defaults chi tiết bên dưới là đề xuất cụ thể để triển khai, chưa phải contract/schema đã tồn tại.
- **Phạm vi lượt tạo tài liệu:** chỉ viết tài liệu; không đổi application code, cấu hình, containers, dữ liệu hoặc chạy target.
- **Kết quả mong muốn:** tạo/chọn/chuyển/dừng/restart/xóa project từ cả Web và CLI, cùng một authority, không sửa `.env` hoặc restart CLI/toàn stack để đổi project.

## 1. Mục tiêu và các quyết định đã chốt

### 1.1 Quyết định sản phẩm

1. **Mỗi project có environment riêng:** một LangGraph runtime container và một sandbox container, workspace và runtime state riêng. Không dùng một runtime process chung cho nhiều project làm kiến trúc cuối.
2. **Một project active trên mỗi deployment tại một thời điểm**, áp dụng chung cho Web, CLI, scheduler, copilot và các caller nền. Không phải một project mỗi browser/tab/CLI process.
3. Web và CLI là hai client của **cùng project registry, quyền, ownership và environment lifecycle**. Project đang chạy ở CLI phải mở được đúng project/thread ở Web và ngược lại.
4. Tách project không đồng nghĩa tách model server. Model provider/LiteLLM và các binary tools đã cài trong image được dùng chung có kiểm soát.
5. `.env` chứa cấu hình deployment; project context được cấp tự động từ project record/environment binding, không yêu cầu operator tự sửa global `RAPTIX_ENGAGEMENT` để đổi project.
6. Restart environment giữ workspace/history/checkpoints; không tự gửi lại prompt, khôi phục tiến trình shell đã chết hoặc thực hiện lại side effect không idempotent.
7. Isolation phải đến từ **mount, routing, ownership và control-plane access**, không chỉ từ system prompt, working directory hoặc kiểm tra prefix.

### 1.2 Defaults cụ thể trong plan

- Project chưa dùng chỉ cần metadata/storage; container có thể được tạo khi activate lần đầu. Project inactive không tiêu thụ runtime/sandbox process đang chạy.
- Xem project, findings, reports hoặc review tài liệu **không tự activate runtime**. Activate là mutation có quyền; client thể hiện rõ project đang xem và project đang active nếu khác nhau.
- Khi A còn run/tool/question cần xử lý, mở B không âm thầm kill A hoặc chạy song song B. UI/CLI trả trạng thái busy và cho operator chọn tiếp tục A hoặc **Stop A and switch to B**. Không thêm reviewer approval mới cho thao tác này.
- Pause một operation không tự giải phóng active-project slot: runtime/sandbox có thể vẫn chạy. Muốn chuyển project phải stop/reconcile environment A.
- Laptop/API/controller restart không tự resume execution. Reconcile resource thực tế trước, rồi operator chọn activate/continue.
- Archive/stop giữ dữ liệu. Xóa vĩnh viễn là thao tác có tên riêng, theo retention và các gates hiện có; không dùng `docker compose down -v` làm implementation của nút Delete Project.

### 1.3 Phạm vi và anti-goals

**Bao gồm:** lifecycle manager tin cậy, durable single-active coordination, routing runtime theo project, CLI/Web parity, isolation workspace/state/network, migration và release acceptance.

**Không bao gồm:** Kubernetes, multi-host scheduling, nhiều project chạy đồng thời, image riêng cho từng project, LLM server riêng/project, queue/event platform mới, redesign toàn bộ UI hoặc rewrite thuật toán agent/tool selection.

Một project có thể có nhiều thread, subagent hoặc tool chạy song song theo admission hiện hữu. **Single-active-project không có nghĩa single-thread/single-agent.** State/workspace được chia sẻ trong cùng project là chủ đích; vẫn giữ run/attempt/session identity và conflict handling.

Plan này là workstream kiến trúc mới, không phải P14–P23 nối tiếp plan UI cũ. Các mã **I00–I09** là implementation phases, không tạo thêm ticket graph. Map patches về owning packages 01/02/03/04/05/07/09/13/16/17/18 trong [18 work packages](../../apps/web/.scratch/frontend-backend-integration/coverage.md#7-approved-18-ticket-delivery-graph).

## 2. Baseline source và deployment cần đối chiếu

### 2.1 Những khác biệt đã quan sát

| Concern | CLI `make cli-dev` hiện tại | Web hiện tại | Hệ quả |
|---|---|---|---|
| Runtime | Một `raptix-langgraph`, URL theo deployment | Một `web-runtime` chung cho các project | Chưa có runtime riêng/project |
| Identity | Pin từ `.env`, CLI gửi slug và `/workspace/<slug>` | DB engagement ID + immutable workspace slug | Cần cùng authority thay vì hai nguồn chọn project |
| Workspace | Bind toàn workspace root vào sandbox | Web volume chung; `sbx-<slug>` mount volume subpath | CLI fence chưa là mount isolation |
| Thread | Search/restore trực tiếp runtime, chưa scope đầy đủ theo project | Prisma ownership/binding rồi mới gọi runtime | Có thể chọn nhầm lịch sử ở CLI |
| State | CLI và Web có runtime-state volumes riêng | Các project Web cùng runtime-state volume | Không tự chuyển thread giữa hai plane được |
| Lifecycle | `infra up --build` và watch gắn vào startup CLI | Provision project sandbox qua launcher | Tạo/chuyển project chưa có lifecycle chung |
| Network | CLI network riêng với Web | Project sandboxes, shared sandbox và runtime cùng sandbox network | Subpath mount đúng nhưng management access còn hở |

Trong lượt kiểm tra trước khi viết plan, probe từ một Web project sandbox cho thấy: peer directory không hiện trực tiếp trong filesystem, nhưng HTTP tới peer sandbox/shared sandbox và runtime thread inventory vẫn trả 200 không credential. Probe chỉ dùng file không tồn tại, không đọc nội dung project khác. CLI file API trả 403 cho đường dẫn ngoài engagement, nhưng container vẫn mount toàn root và thấy directory project khác. Đây là evidence của deployment lúc kiểm tra, không chứng nhận tree/image tương lai.

**Single-active làm giảm bề mặt peer API nếu project khác thực sự stopped; không phải lý do giữ shared sandbox mount toàn dữ liệu, runtime API không auth, hoặc vô tình để environment cũ chạy.**

### 2.2 Source map

| Source | Điểm cần đổi/giữ |
|---|---|
| [`Makefile`](../../Makefile), [`docker-compose.yml`](../../docker-compose.yml) | `cli-dev`/`infra` không còn quyết định project bằng global pin; base services tách khỏi project environments |
| [`docker-compose.web-runtime.yml`](../../docker-compose.web-runtime.yml) | Thay runtime/shared sandbox dùng chung bằng topology environment riêng; không thay mount của dữ liệu đang chạy thiếu migration |
| [`apps/launcher/cmd/start.go`](../../apps/launcher/cmd/start.go), [`cmd/web.go`](../../apps/launcher/cmd/web.go) | Launcher, dev và Web dùng cùng lifecycle; không có logic provision riêng lệch nhau |
| [`internal/sandboxes/sandboxes.go`](../../apps/launcher/internal/sandboxes/sandboxes.go), [`sync.go`](../../apps/launcher/internal/sandboxes/sync.go), [`internal/opscontrol/`](../../apps/launcher/internal/opscontrol/) | Inventory orchestration hiện có; mở rộng module/controller có owner, không suy từ tên `sbx-*` trên toàn daemon |
| [`apps/cli/src/hooks/useAgent.ts`](../../apps/cli/src/hooks/useAgent.ts), [`utils/threadStore.ts`](../../apps/cli/src/utils/threadStore.ts) | CLI hiện gọi raw LangGraph; chuyển sang facade project-scoped và filtered history |
| [`apps/web/server/src/main.ts`](../../apps/web/server/src/main.ts), [`config/runtime.ts`](../../apps/web/server/src/config/runtime.ts) | Hiện tạo runtime/join clients từ một URL; thay bằng project-aware resolution |
| [`runtime-context.ts`](../../apps/web/server/src/services/runtime/runtime-context.ts), [`runtime-ownership.ts`](../../apps/web/server/src/services/runtime-ownership.ts) | Giữ trusted identity, context proof, membership và run ownership; bổ sung environment binding |
| [`execution-client.ts`](../../apps/web/server/src/integrations/runtime/execution-client.ts), [`read-client.ts`](../../apps/web/server/src/integrations/runtime/read-client.ts), [`join-client.ts`](../../apps/web/server/src/integrations/runtime/join-client.ts) | Routing nhất quán cho mutation, read, recovery và SSE |
| [`runtime/run-service.ts`](../../apps/web/server/src/services/runtime/run-service.ts), [`stream-service.ts`](../../apps/web/server/src/services/runtime/stream-service.ts) | Không dùng current UI selection để retarget request/run/SSE đã capture |
| [`filesystem.py`](../../packages/raptix/raptix/middleware/filesystem.py), [`backends/factory.py`](../../packages/raptix/raptix/execution/backends/factory.py), [`bash.py`](../../packages/raptix/raptix/execution/tools/bash/bash.py) | Model/child tools không được đổi workspace/endpoint; filesystem và bash cùng sandbox |
| [`checkpointer.py`](../../packages/raptix/raptix/interfaces/api/checkpointer.py), [`instance_mailbox.py`](../../packages/raptix/raptix/execution/session/instance_mailbox.py) | Checkpoint, thread metadata, mailbox/grants phải cùng project state và sống qua recreate |
| [`schema.prisma`](../../apps/web/server/prisma/schema.prisma), [`workspace-policy.ts`](../../apps/web/server/src/security/workspace-policy.ts) | Additive schema/binding; canonical paths và project-specific containment |
| [`langgraph.json`](../../langgraph.json) | Graph catalog và global `.env` loading cần deployment profile rõ; không nạp lại config của project khác |

Quy tắc/ADR liên quan: [runtime ownership](../architecture/runtime-boundaries.md), [dependency rules](../architecture/dependency-rules.md), [ADR-0082](../adr/0082-dedicated-web-execution-plane.md), [ADR-0086](../adr/0086-per-run-sandbox-workspace-isolation.md), [ADR-0089](../adr/0089-pin-instance-delivery-and-controls-to-attempts.md), [ADR-0090](../adr/0090-trusted-engagement-identity-and-operator-grants.md). I00 phải ghi Proposed ADR mới, nêu rõ phần nào supersede các topology cũ; không đổi lịch sử Accepted thành đã có evidence cho topology mới.

## 3. Kiến trúc đích và isolation contract

### 3.1 Topology

```text
Web UI -------------------+
                          +--> Fastify control plane (auth + projects + lifecycle intents)
CLI project-aware --------+           |
                                      +--> PostgreSQL: registry/ownership/active slot/intents
                                      |
                                      +--> trusted host environment controller (Go)
                                      |      Docker/Compose: allowlisted project resources
                                      |
                                      +--> project-scoped runtime resolver / authenticated proxy
                                                  |
                         +------------------------+----------------------+
                         |                                               |
                 Environment A: active                        Environment B: stopped
                 LangGraph runtime A                          runtime B metadata/state
                         |                                    sandbox B metadata
                 sandbox A                                    workspace B retained
                 workspace A
                 runtime state A

Shared: control plane + workflow DB + model proxy + read-only corpus/images
Project runtime/sandbox: no access to peer environment or container-management API
```

**Hai container/project là tối thiểu cho runtime và tools, không phải hai lần tải bộ tools.** Runtime không mang quyền/công cụ shell của sandbox chỉ để giảm số container. Shared infrastructure có thể có nhiều container thường trực, nhưng không có runtime/sandbox của một project thứ hai được admit hoạt động.

### 3.2 Quyền và authority

| Concern | Authority | Contract |
|---|---|---|
| Actor/project access | Fastify + memberships | CLI có identity tin cậy như Web; local profile vẫn qua facade với local actor, không gọi raw runtime để bypass |
| Project ID, slug | Engagement DB | ID/slug bất biến; display title và `roe.json` không đổi resource identity |
| Environment desired state | Control plane DB | Một binding/environment cho project trong deployment; version/CAS và command intent bền vững |
| Resource observed state | Host controller + actual runtime | `requested` không đồng nghĩa `running/stopped/deleted`; failures/uncertain được reconcile |
| Single-active slot | Một record/coordination point bền vững per deployment | Tất cả entrypoints dùng cùng admission, kể cả CLI/worker/admin scripts |
| Threads/runs/attempts | Project runtime + Web ownership ledger | Pin project/environment; không adopt theo thread ID hoặc display name tùy ý |
| Execution authorization | Governance/runtime hiện hữu | Activate chỉ khởi động environment, không cấp quyền execute, bỏ HITL, stop hoặc plan gates |
| Workspace bytes | Storage riêng/project | Runtime/sandbox chỉ mount project mình; trusted API đọc retained data theo membership |
| Provider actions/remote resources | Provider + command ledger | Stop container không tự đồng nghĩa remote job/session đã cleanup |

**Lifecycle state, operation state và engagement business status là ba trục riêng.** Environment stopped không làm project closed, operation completed hoặc run success.

### 3.3 Host controller

- Dùng một module Go có owner trong launcher, triển khai bằng controller host-local tin cậy; có thể mở rộng nền opscontrol nhưng cần namespace project lifecycle riêng. Không để LLM tool `ops_*` được quyền tạo/xóa/chuyển environment của deployment.
- Fastify là public entrypoint cho Web/CLI và owner của durable intents. Controller chỉ thực thi resource operations đã authorize và báo observation; không tạo một project registry song song trong JSON hay Compose filenames.
- CLI có thể chạy control plane local ở chế độ headless: không cần mở browser hoặc một phiên UI để dùng CLI. Installer/`make cli-dev` bootstrap API/controller/dependencies tự động; local profile không bắt operator tự đăng nhập Web chỉ để chọn project. CLI vẫn không import Prisma hoặc tự có một database authority khác.
- I00 chốt transport nội bộ authenticated phù hợp host/WSL/container, request/response limits và deployment registration. Không expose controller công khai; không mount Docker socket vào Fastify, runtime hoặc sandbox.
- Interface hẹp theo các hành vi `ensure/start/observe/stop/recreate/remove`; nhận environment identity/version và image refs đã allowlist, không nhận arbitrary shell/Compose YAML/host paths từ browser/LLM.
- Resource gắn labels `deploymentId`, `projectId`, `environmentId`, `role`, `generation`. Observe/cleanup chỉ thao tác labels thuộc deployment và binding đó. Không `docker rm` mọi `sbx-*`, không global prune.

### 3.4 Mount và endpoint invariants

1. Giữ quy ước nội bộ **`/workspace/<workspaceSlug>`** trong runtime, sandbox và API view để giảm migration path. Chỉ project data tương ứng được mount vào runtime/sandbox, không mount parent chứa mọi project.
2. Runtime state riêng tại `/app/.langgraph_api`, gồm checkpoint DB và metadata Agent Server cần phục hồi, mailbox/grants. Không chia sẻ SQLite state file giữa runtime containers.
3. API là trusted reader của các project artifacts, được dùng root view hoặc storage adapter nhiều project, nhưng mọi request vẫn resolve project/role/opaque ref trước đọc. Không đưa root view đó cho agent runtime.
4. URL/runtime identity lấy từ trusted environment registry; không nhận `sandbox_url`, runtime URL, image hoặc volume từ model/browser làm authority.
5. Container IP không là identity. `environmentId` ổn định qua restart; generation phân biệt process/container incarnation và chặn ACK cũ. Boot generation không tự đổi business context hash rồi khóa toàn bộ existing threads.
6. Endpoint cache key phải gồm deployment/environment và incarnation phù hợp. SSE đã mở cho A không bị chuyển sang B khi operator đổi selection.

### 3.5 Network, credentials và threat model

- Single-active giảm nhu cầu scheduling nhiều tenant, **không xóa yêu cầu auth/routing**. Phải phát hiện orphan containers trước khi start B; không suy inactive chỉ từ UI.
- Runtime management endpoints chỉ nhận control-plane caller đã authenticate. Sandbox không được truy cập runtime thread/run/control APIs, controller, Docker socket hoặc peer sandbox APIs. Runtime chỉ được điều khiển sandbox thuộc environment của nó.
- Shared fallback `web-sandbox` mount mọi project không được là đường dự phòng trong topology mới. Thiếu endpoint/config thì fail closed, không route về container chung.
- Nếu dùng bearer credentials, scope theo environment/role, không dùng một secret management chung được phát cho mọi sandbox. Không chuyển secret vào chat, logs, SSE hay browser localStorage.
- Không dùng nguyên `env_file: .env` cho mọi project container. Runtime/sandbox nhận allowlist config; deployment admin credentials và host OAuth files không tự được mount vào mọi environment.
- Model provider có thể shared; dùng broker/credentials phù hợp scope, budget và revocation. Neo4j/shared data phải chặn cross-project ở interface/credential thực sự: không cấp DB admin credential cho runtime rồi gọi Cypher filter là hard isolation.
- I00 phải chốt quyền shared data theo backend đang dùng: project-limited DB role/database nếu hỗ trợ, hoặc scoped data facade chỉ nhận typed operations và bind project theo caller credential, không arbitrary Cypher. Corpus chung read-only, không chứa engagement secrets.
- Container dùng chung host kernel, image và control plane; plan không tuyên bố chống Docker daemon/host compromise hoặc là full tenant-hosted isolation. Vẫn giữ hardening/network/ROE/egress hiện có; mọi thay thế safety-critical cần ADR/threat model theo contribution rules.

## 4. Lifecycle, identity và persistence

### 4.1 Minimal durable records dự kiến

Reuse Engagement/EngagementThread/WebRequestLedger cho business identity/run intents. Bổ sung model environment nhỏ nhất đáp ứng các facts sau; tên/schema cuối được đóng ở I00–I01:

- **Environment binding:** deploymentId/projectId/environmentId; storage refs; desired/observed state; observedAt; image digests; version; generation; last error. Một binding canonical cho mỗi project/deployment.
- **Deployment execution slot:** owner environment/project, phase/version của activation/switch, commandId. Global trong deployment, không phải per actor/browser.
- **Environment command:** requestId, actor, target/source, action, expectedVersion, payload fingerprint, accepted/observed/refused/uncertain/final outcome. Retry cùng intent trả cùng record; cùng ID khác payload conflict.
- **Thread binding extension:** environment identity/legacy origin và phiên bản config cần cho routing. Không copy full child graph hoặc transcripts vào Prisma.

`WebRequestLedger` hiện giới hạn run/thread operations; không nhét lifecycle actions mới vào enum rồi làm hỏng existing recovery. Có thể dùng persistence primitive hiện có, nhưng facts môi trường và facts execution phải phân biệt.

### 4.2 State machine đề xuất

```text
unprovisioned -> provisioning -> stopped -> starting -> ready
                                               ready -> stopping -> stopped
                                               ready -> restarting -> ready
any managed state -> deleting -> deleted
failures/disconnect -> error/uncertain -> reconcile -> observed state
```

- `ready` có nghĩa runtime/sandbox/identity/storage checks pass; không chứng nhận model inference, tool authorization hoặc plan đã approved.
- `stopped` chỉ khi process/container liên quan đã được quan sát dừng. `deleted` chỉ khi các resource được yêu cầu đã được xác minh xóa hoặc retention disposition đúng.
- Environment `starting`, `ready`, `stopping`, `restarting` và trạng thái uncertain còn resource có thể chạy đều giữ slot. Không start B trong khoảng chuyển tiếp này.
- `provisioning` có thể tạo storage/config/container ở trạng thái stopped mà không chiếm execution; nếu cần khởi động bất kỳ project runtime/sandbox process nào để bootstrap thì phải giữ slot trước. Không dùng `compose up` hàng loạt cho inactive projects rồi gọi đó là provision-only.
- DB transaction chỉ reserve intent/slot; không giữ transaction lock qua image pull, startup hoặc Docker stop. Observations finalize bằng CAS.
- Không giải phóng slot chỉ vì lease timeout hoặc controller mất heartbeat. Trước khi cấp slot cho B phải reconcile containers/runs của A; nếu không xác minh được thì giữ uncertain và refuse start B.
- Đổi active slot/project cần quyền lifecycle của deployment, không chỉ membership trên project B. Biết A đang active không cho actor của B xem brief/history/resource IDs chi tiết của A; busy response phải theo quyền, và actor không có quyền stop A không được chuyển thay người khác.

### 4.3 Switch A → B

1. Check actor có quyền activate B và quyền stop A nếu switch cần stop; ghi requestId và expected versions.
2. Nếu chỉ đổi project đang xem thì không đổi slot. Khi yêu cầu execution B, reserve transition chung; request CLI/Web đua nhau chỉ một winner.
3. Nếu A busy, trả trạng thái và lựa chọn rõ; không tự bỏ question/approval hoặc kill work. Operator explicit stop-and-switch mới vào bước dừng.
4. Dừng admission mới của A. Yêu cầu bounded graceful interruption; quan sát runtime/child/tools. Nếu cần stop sandbox/process thì ghi kết quả interrupted/uncertain, không gọi đó là pause đã resume được.
5. Xác minh runtime và sandbox A đã dừng, checkpoint/artifacts đã flush hoặc uncertainty có disposition; sau đó mới start B.
6. Start đúng storage/images B, readiness và project identity checks, rồi báo ready. Nếu B start fail, giữ A stopped và báo fail; không tự rerun A/B. Retry cùng command reconcile resource đã có.
7. Browser/CLI dispose streams/cache selection của A; late ACK vẫn gắn A. Nếu có consumer khác đang xem A, hiển thị stopped/switch event; không lén chuyển nội dung họ sang B.

### 4.4 Restart, shutdown và resume

- Restart runtime A không recreate sandbox B hoặc shared infrastructure. Restart sandbox A dừng tools A; không khẳng định remote resources đã kết thúc.
- Thread/checkpoint/OPPLAN/history tồn tại qua recreate vì storage không nằm trong writable layer. Running attempts mất process chuyển interrupted, queued guidance có disposition; không tự chuyển message sang replacement attempt.
- Resume question/P11 pause dùng authoritative checkpoint và recheck membership/scope/plan/preflight/stop/HITL/sandbox. **Run ID mới không tự đồng nghĩa dispatch attempt mới.** Retry/reassign vẫn là explicit commands có lineage.
- Audit cách LangGraph replay child `task` tương tác với `cancelled_intent`/`interrupted_intent`: phải phân biệt authorized checkpoint continuation với fresh redispatch. Không bypass guards hoặc cấp retry grant rộng chỉ để resume chạy qua.
- Tool in-flight có thể đã tạo output dù ACK chưa về. Kiểm tra counter/artifact/intent trước retry; không lấy “container đã restart” làm bằng chứng side effect chưa xảy ra.
- Shutdown laptop giết process; dữ liệu durable không đồng nghĩa mọi progress trong RAM sống sót. Startup reconcile cùng active slot; không start cả các project có restart policy cũ. Controller tạo environments với policy không tự start ngoài admission; shared infrastructure có thể tự start.

### 4.5 Stop, archive, delete

| Action | Giữ gì | Điều kiện/outcome |
|---|---|---|
| Stop | Workspace, runtime state, Web records | Verify process stopped; keep checkpoint semantics truthful |
| Restart | Như Stop | Recreate cùng environment/storage identity; image chỉ đổi theo update explicit |
| Archive | Artifacts/history theo retention | Business read-only/archive policy hiện có; không tự Mark complete |
| Delete permanently | Audit/tombstone/retained records theo policy | Fence admission; stop/reconcile; xóa đúng resources; cleanup lỗi thì retry từ intent cũ |

Deletion không cascade xóa shared images, model proxy, project khác hoặc toàn Neo4j/Postgres. Chỉ xóa KG partition/resource được phép của project. Pending command/approval, remote sessions/jobs và retained export phải có disposition. Không tự đóng/terminate provider resources khi chỉ restart local environment. Nếu policy chưa cho hard-delete một workflow record, UI phải giữ archive/retention đúng nghĩa thay vì xóa DB thẳng.

## 5. Dùng chung images, binary tools và cấu hình

### 5.1 Docker storage và tools

- Mọi runtime dùng cùng runtime image digest; mọi sandbox dùng cùng sandbox image digest/profile phù hợp. **Không build hoặc tag image theo từng project.**
- Docker chia sẻ read-only image layers trên cùng daemon. Image tools minh họa 20 GB không biến thành 100 GB chỉ vì tạo 5 containers cùng image; writable layers, project data và image versions mới mới cộng thêm dung lượng. Không dùng số minh họa làm benchmark thực tế.
- Cài tools/dependencies ổn định khi build image. Không chạy `apt install`/`pip install` cả bộ mỗi lần Create/Activate project. Download/pull chỉ khi image/profile/version chưa có; offline start dùng cache hoặc trả missing image rõ.
- Templates/corpus bất biến có thể chung read-only. Cache mutable chỉ share khi tool hỗ trợ concurrency/locking và không chứa credentials, sessions, target responses hoặc project output; không share toàn home directory của tool.
- Process/tmux/background jobs vẫn riêng container/project. Dùng chung binary installation không có nghĩa dùng chung process hoặc session.
- Pin image digest trong environment record. Existing environment không âm thầm chạy version mới vì `make cli-dev` vừa build đè tag `stable`; update/rollback explicit và có compatibility check state/schema.
- RAM/CPU không chia sẻ như image layers: mỗi runtime nạp graph/worker/connections riêng. Chỉ một environment active giúp giảm RAM; cấu hình worker/resource theo số đo, không nhân nguyên 10 workers cho mọi profile. `mem_limit` là trần, không phải RAM luôn được cấp sẵn.

### 5.2 Config và platform paths

| Loại config | Nơi quản lý | Ví dụ |
|---|---|---|
| Deployment | Installer/controller/control plane | DB/model broker, storage backend/root, image catalog, controller endpoint, TLS/auth |
| Project | Canonical DB/binding | projectId, workspaceSlug, environmentId, storage refs, target/scope/ROE |
| Environment bootstrap | Controller-generated allowlist | pin project identity, canonical container paths, sandbox endpoint, scoped credentials |
| Run | Server-issued trusted config | thread/run/attempt, config revision, permitted overrides, authorization context |
| Client preference | UI/CLI state | project đang xem, pane widths, draft selection; không là execution authority |

`.env` vẫn tồn tại cho deployment, nhưng không phải database của active project. CLI không tự route raw LangGraph từ `RAPTIX_API_URL` và global pin trong product flow mới; dùng control-plane endpoint và authenticated project selection. Legacy raw mode chỉ để migration/debug có tên, tách khỏi default single-active contract và không âm thầm chạy song song managed environments.

Host path và container path là hai field/representation khác nhau. WSL dùng `/mnt/d/...`, Windows dùng `D:/...` khi hợp lệ với Docker client tương ứng; bên trong runtime/sandbox luôn dùng canonical POSIX path. Controller normalize theo platform trước create resource và fail với thông báo rõ. Không sửa `.env` lặp lại để đi qua hai kiểu path; không copy host path vào `configurable.workspace_path`.

## 6. Migration và recovery

### 6.1 Inventory trước migration

- Chụp DB schema/rows, deployment identity, images/digests, containers/labels/networks/mounts, workspace/checkpoint storage, run/intent status. Không log credentials.
- Có ít nhất hai nguồn legacy khác nhau: CLI host bind + state volume; Web workspace/state volumes + PostgreSQL ownership. Cùng display name/slug ở hai nguồn **không chứng minh cùng project**.
- Lập mapping `legacy deployment/source → engagement/thread/workspace/state → canonical project/environment`, có provenance và trạng thái verified/unresolved. Không merge chỉ bằng tên hoặc deduce ownership từ artifact text.
- Backup DB, workspace và **toàn bộ runtime state cần thiết**, bao gồm SQLite WAL/SHM hoặc snapshot nhất quán, thread/run Agent Server metadata, mailbox/grants. Không chỉ copy `checkpoints.sqlite` trong khi runtime vẫn ghi.

### 6.2 Cách chuyển

1. Dùng dedicated test storage/DB để rehearsal; chưa mutate deployment người dùng trước khi backup và mapping pass.
2. Thêm schema/contracts rồi route mới phía sau deployment flag. Mỗi project có routing mode rõ `legacy` hoặc `environment`, không tự fallback vì endpoint mới lỗi.
3. Quiesce nguồn legacy: ngăn run mới, chờ/dừng run có chủ đích, reconcile uncertain requests và flush state trước snapshot.
4. Tách workspace theo canonical project. Runtime/sandbox mới chỉ mount dữ liệu project tương ứng; không đổi paths tùy tiện làm hỏng artifact refs.
5. Migrate thread metadata/checkpoints/mailbox/lineage bằng interface/format đã kiểm tra. **Không clone nguyên shared runtime-state volume vào mọi project.** Giữ thread/run IDs nếu import hỗ trợ; update binding bằng migration có version, không bỏ context validation.
6. Với thread không có nguồn attribution hoặc không thể import an toàn: giữ historical read-only, tạo thread mới explicit; không certify resume thành công hoặc bịa mapping. Required recoverable threads vẫn là blocker đến khi migrate/verify được.
7. Verify canonical project từ cả CLI/Web, restart đúng environment, đối chiếu records/bytes và history. Sau đó mới retire legacy caller paths và shared project execution resources.

### 6.3 Rollback

- Mỗi environment pin image/state schema compatibility. Rollback code không xóa volume/schema mới; không gắn state đã forward-upgrade vào image không đọc được.
- Không bật cùng lúc legacy runtime và environment runtime để cùng ghi workspace/checkpoints. Chuyển mode bằng CAS và kiểm observed processes.
- Restore snapshot chỉ khi xác định dữ liệu sau snapshot và cách xử lý; không rollback bằng seed/reset toàn hệ thống. Unknown outcome giữ uncertain, không tự resend.

## 7. Implementation plan — I00–I09

**Đúng 10 phase.** Mỗi phase có thể gồm nhiều patch nhỏ một concern, ≤400 runtime lines/≤10 files theo [quality bar](../QUALITY_BAR.md). Tách supply-chain/container packaging khỏi feature behavior khi cần; không coi một phase là quyền làm mega-PR. Contract/schema/controller/router writes được serialized với các session đang làm UI.

### I00 — Khóa architecture contract, ADR và migration baseline

- **Owner:** architecture/contracts + runtime/launcher + Web integrator; không phụ thuộc phase trước.
- Chụp baseline §2/§6, project sources và active processes. Ghi Proposed ADR về runtime+sandbox riêng, single-active, host-controller trust, shared data credentials và migration; threat model cho thay đổi safety-critical.
- Chốt interface lifecycle/resolver và transport authenticated của host controller; chọn existing module extension hoặc module mới có owner, không tạo hai controllers cạnh tranh. Chốt defaults §1.2 và hard-delete policy theo workflow hiện có.
- Name exact intended files/test seams/budgets cho I01 trước implementation. Ghi phần supersede ADR-0082/0086, giữ các invariants còn hiệu lực và liên kết plan UI cũ.
- **Test:** docs/config inspection, links, mapping completeness; không unit suites, model run, Docker rebuild hoặc target contact cho docs-only.
- **Exit:** không còn mơ hồ về authority, active-slot scope, state ownership, runtime/sandbox mount paths hoặc routing mode của legacy projects.

### I01 — Durable registry, lifecycle intents và global active admission

- **Phụ thuộc:** I00. **Owner:** contracts + Prisma/server.
- Thêm shared DTO/validators và additive persistence tối thiểu §4.1. Lifecycle intents có stable requestId/fingerprint, expectedVersion và observed/refused/uncertain outcomes.
- Implement slot/CAS cho toàn deployment. Reserve transition trước work bất đồng bộ; không giữ DB transaction trong Docker operation. Same-project ensure/retry idempotent; request khác body conflict.
- Admission dùng chung cho create-run, resume, retry/reassign, scheduler, copilot và CLI. Bị busy thì không silently queue một execution tương lai chưa được authorize.
- **Test bắt buộc:** wire nested IDs/enums/bounds; database thật clean+upgrade; Web activate A và CLI activate B đồng thời chỉ một winner; duplicate/lost ACK; crash sau reserve; stale version; expiry không giải phóng slot khi chưa biết process đã dừng; viewer/foreign project refused.
- **Exit:** không client nào có thể admit project thứ hai bằng cách mở tab khác hoặc gọi một entrypoint khác.

### I02 — Host controller và environment resources theo project

- **Phụ thuộc:** I01. **Owner:** Go launcher/controller + Compose packaging.
- Implement controller interface §3.3 và authenticated adapter từ control plane. Create runtime+sandbox resources idempotent bằng image có sẵn, labels/name scoped deployment/environment.
- Runtime mount own workspace + own state; sandbox mount own workspace; shared services không thuộc project Compose teardown. Controller cấp bootstrap allowlist, không nạp nguyên `.env`/Docker socket vào project.
- Enforce network/auth contract §3.5, fail closed khi identity/endpoint thiếu; loại shared sandbox fallback trong mode mới. Kiểm tra actual resources/identity khi tên đã tồn tại; không adopt foreign container.
- **Test bắt buộc:** Go renderer/controller positive+invalid IDs/paths/labels; actual Docker mount/network inspect; runtime/sandbox A không thấy B/state B qua direct path, `..`, symlink hoặc HTTP; sandbox không gọi được management/controller API; unrelated container có tên tương tự không bị sửa/xóa; repeat ensure không install/pull lại tools; missing image/outage có outcome rõ.
- **Exit:** một environment chạy được bằng image cache, đúng isolation; tạo/start B chưa được phép nếu active slot thuộc A. Bootstrap tests không cần model/target.

### I03 — Project-aware runtime routing, ownership, SSE và recovery

- **Phụ thuộc:** I01–I02. **Owner:** shared contracts + Fastify runtime integration.
- Thay singleton runtime/join client bằng resolver theo captured project/environment binding. Giữ một interface cho reads/mutations/SSE, không mỗi handler tự dựng URL.
- Route đủ catalog/readiness, thread/run/state/history, messages/grants, question/P11 resume, pause/cancel/complete, Fleet/Trace/timeline, scheduler và reconcile. Missing/stopped runtime trả explicit state; không fallback legacy/current active project.
- Inactive project vẫn xem được persisted Web records/artifacts theo quyền. Runtime history cần activation hoặc historical projection có source/freshness rõ; global counts/timeline không tự start các inactive environments lần lượt rồi chiếm slot.
- Capture environment/version cho command; stale ACK, endpoint cache và reconnect không retarget sau switch. Giữ membership re-attestation của SSE.
- **Test bắt buộc:** runtime boundary tests dùng hai distinct endpoint doubles; A request không tới B kể cả khi active selection đổi; foreign thread/run refused; generation đổi thì cache refresh đúng environment; SSE disconnect/reconnect/revoke; uncertain run reconcile cùng source; inactive runtime không thành empty/success hoặc tự activate; actual scoped HTTP happy+refusal.
- **Exit:** toàn bộ runtime consumers đi qua project resolver, không còn một global URL quyết định mọi project trong managed mode.

### I04 — CLI project-aware dùng cùng control plane với Web

- **Phụ thuộc:** I03. **Owner:** Ink CLI + launcher entrypoints.
- CLI dùng project list/auth/context/threads/commands của facade. Local single-user profile có trusted local actor; multi-user profile dùng session/credential flow hiện có phù hợp, không tự chọn role.
- Project selection, activation và thread selection là các thao tác riêng rõ ràng. `/resume` xác minh project/environment trước render history hoặc dispatch; thread thiếu nguồn là historical/unknown, không migrate bằng tên.
- Planning→handoff→execution, question/HITL answers, cancel và reconnect giữ semantics đúng. Đổi project dispose old subscriptions/drafts phù hợp scope; không restart Ink process.
- `make cli-dev`/launcher đảm bảo shared infrastructure và controller một lần; project switch không chạy global `infra up --build`. Node/runtime watch chỉ là development behavior explicit, không áp dụng tự động lên managed active execution nghiệm thu.
- **Test bắt buộc:** CLI hook/client tests cho scoped list/restore/submit, wrong project/thread refused trước lộ history, lost ACK, actor/deployment switch; initial+handoff cùng environment; không có global project `.env` vẫn chạy. Actual foreground TTY: mở A ở CLI, thấy cùng project/thread trong Web, stop/switch B mà CLI không thoát và A history không biến thành B.
- **Exit:** không cần `export RAPTIX_ENGAGEMENT=...`, sửa `.env` hay restart CLI để quản lý project; raw legacy mode không còn default product path.

### I05 — Web project lifecycle UX và các consumer nền

- **Phụ thuộc:** I03; phối hợp I04. **Owner:** Web features/shell + server admission.
- Nối create/view/activate/switch/restart/stop vào project UI chung; giữ style/shared ports. Hiển thị active project của deployment, environment state, startup progress và lỗi có hành động tiếp theo.
- Busy switch dùng defaults §1.2/§4.3, không thêm approval workflow. Refresh giữa starting/stopping/uncertain phục hồi cùng command; double click không tạo containers/runs trùng.
- Copilot, scheduled runs, notices/overview/Fleet/closeout và global searches dùng đúng inactive semantics, không bí mật start runtime hoặc nói cleanup xong khi controller chưa observe.
- **Test bắt buộc:** focused rendered tests cho busy switch, viewer, stale ACK, two-tab/Web-vs-CLI race, refresh/recovery và dirty draft; browser keyboard/modal/action states trên các phần đổi; local browser flow Create A→activate→stop→B, không đổi `.env` và không restart UI/API. Không chạy toàn bộ viewport matrix.
- **Exit:** operator quản lý lifecycle từ Web hoặc CLI bằng cùng facts; inactive record browsing không cướp active slot.

### I06 — Stop/switch/restart/delete recovery hoàn chỉnh

- **Phụ thuộc:** I02–I05. **Owner:** controller + runtime/mission + workflow services.
- Hoàn thiện drain/refuse admission, bounded stop, observed process termination, boot reconciliation, archive/delete/retention và cleanup retries. Labels+binding là authority resource cleanup; orphan/partial resources có named outcomes.
- Tích hợp P10 mailbox/grants và P11 checkpoint/question semantics, không conflating container stop với pause/completion. Resume rechecks governance và không duplicate child/tool side effects.
- API/controller restart không làm mất command journal; Docker autostart không tự chạy nhiều project. Scheduler không dispatch vào deleting/stopped project ngoài activation contract. Remote resources có disposition, không mặc định kết thúc theo container.
- **Test bắt buộc:** deterministic graph/tool counter; stop giữa model/tool, paused restart, pending question resume, duplicate stop/restart/delete, controller mất kết nối sau Docker ACK, partial runtime/sandbox start, stop timeout giữ slot, crash sau stop A trước start B, lost ACK/cancel race, cleanup fail rồi retry. Cross-client delete refused khi actor không có quyền; project B/shared images/DB còn nguyên.
- **Exit:** mọi lifecycle action có observed/final hoặc uncertain rõ; không tự chạy lại work, không tạo hai active environments và không “xóa thành công” khi còn resource ngoài disposition.

### I07 — Migrate dữ liệu CLI/Web hiện có và compatibility cutover

- **Phụ thuộc:** I03–I06. **Owner:** migration/runtime + schema + storage integrator.
- Implement inventory/mapping/import/check theo §6 trên bản copy trước. Legacy CLI engagement được đăng ký canonical project có owner, không tự biến mọi folder thành project hoặc merge cùng tên.
- Migrate workspace, checkpoint/thread metadata/mailbox/grants và update ownership/config proof có version. Snapshot nhất quán khi source quiesced; backup restore được trước cutover dữ liệu thật.
- Historical-only exceptions phải có nguồn/lý do; required resumable cases chưa pass vẫn open. Giữ old records/volumes read-only theo retention; không xóa để test xanh.
- **Test bắt buộc:** fixture hai legacy project cùng display name ở CLI/Web; IDs/bytes/history/counts đúng; project A không nhận rows B; old pending question/paused checkpoint và uncertain intent phục hồi đúng hoặc được refuse có lý do; upgrade DB+restart API; rehearse compatible rollback không có dual writers. Một existing project thật được mở ở cả CLI/Web sau migration, không cần contact target.
- **Exit:** migration có dry-run/report, verification và rollback; không còn phụ thuộc việc operator tự copy thư mục/SQLite hoặc sửa binding DB.

### I08 — Images/tools/platform packaging và retire paths cũ

- **Phụ thuộc:** I02, I04–I07. **Owner:** launcher/tooling/deployment.
- Hoàn thiện installer/dev entrypoints cho Windows/WSL/Linux đang được hỗ trợ, controller bootstrap, image profiles và offline cache. Project operations không build images hoặc reload shared infrastructure.
- Pin digests và safe update/rollback; writable tools/templates/data ở đúng chỗ. Resource start/stopped profile có số đo RAM/disk/cold start cơ bản, không mở performance optimization project.
- Retire shared project runtime/sandbox/raw bypass routes sau khi parity pass; dọn Compose/global pin logic, threadStore comments và docs sai. Không xóa fallback cần rollback trước thời hạn tương thích.
- **Test bắt buộc:** renderer/platform path tests Windows-vs-WSL bind; `docker compose config` và structural network tests khi Compose thay đổi; actual recreate với cached images, hai stopped projects không cài tools lại, representative binaries chạy được; active images không đổi khi build tag mới; startup/offline/missing dependency refusal; clean install và update giữ state. Không chạy destructive `make smoke`/`make clean` trên deployment đang dùng.
- **Exit:** `make cli-dev`, launcher và Web start dùng cùng lifecycle contract; fresh project không download/install cả bộ tool khi image đã có; legacy paths không còn làm project choice phụ thuộc `.env`.

### I09 — Final cross-client acceptance, rollout và runbook

- **Phụ thuộc:** I00–I08. **Owner:** integrator + owners của các seam đổi.
- Chạy ma trận §8, chỉ missing/invalidated cases; reuse evidence đúng source/environment. Build final UI/API/runtime/controller, pin tested tree+schema+digests.
- Một bounded live model/tool run trên local fixture vô hại, nối từ planning đến output/findings/evidence/report JSON/Markdown khi các owning workflows sẵn sàng. Không cần target public, C2 hay phishing để certify isolation/lifecycle.
- Publish runbook create/select/stop/switch/restart/restore/archive/delete và support diagnostics không lộ secrets. Update existing trackers/ADR/plan UI ledger; không tuyên bố P00–P13 cũ tự hoàn tất nhờ đổi topology.
- **Test bắt buộc:** actual Web↔CLI cùng project/thread/output; DB-backed global slot race; environment restart và shutdown/restart recovery; delete/retention isolation; network/path refusal; upgrade/rollback; mock mode không gọi controller. Named gates phải pass hoặc giữ release blocked đúng mục, không dùng screenshot/health alone.
- **Exit:** §9 đạt; không còn manual Docker cleanup/restart CLI để đổi project; không có claim mạnh hơn evidence.

Dependency order: `I00 → I01 → I02 → I03 → (I04, I05) → I06 → I07 → I08 → I09`. Chỉ làm độc lập khi không trùng write ownership; tài liệu này không yêu cầu tự spawn subagents.

## 8. Test selection và acceptance

### 8.1 Quy tắc tiết kiệm thời gian

1. **Docs-only của lượt này:** chỉ links, paths, diff và consistency; không chạy application suites hoặc Docker builds.
2. Trước từng implementation patch, ghi exact changed seams và named suites. Bug: regression fail trước fix, pass sau. Tests qua actual interface, không mock chính function hoặc chỉ assert text/call shape.
3. **Không mặc định full suite**, `make quality` toàn repo, mọi browser viewport, target scans hoặc lặp model calls để lấy xanh. Rộng hơn cần quyết định riêng nêu lý do/scope. CI evidence tách local evidence.
4. Chỉ build dependency/artifact đã đổi hoặc dist stale; typecheck/lint owning packages. Chỉ rerun khi source/contract/schema/config đổi hoặc có concern/failure mới.
5. Có ba mức evidence không thay nhau: unit/contract; real DB/Docker enforcement; cross-client/browser/TTY + bounded model/tool flow. Health 200 không chứng minh isolation hoặc inference.
6. Race/network/restart cases dùng scripted models/tools và local fixture trước; live model dùng một lượt xác minh đường thật. Đo side effects bằng counter/unique artifact và inspect outcome; không mock ACK rồi gọi durable recovery đã pass.
7. Test resource có run ID/labels; không đụng existing live runs, blanket kill Node/Docker, global prune hoặc purge volumes. Theo Web AGENTS, temporary-process stop/cleanup trên Windows có hard cap 5 giây; nếu còn process thì ghi survivor/blocker, không đổi app để lách lỗi process management. Product lifecycle timeout và pending-stop semantics được test riêng.

### 8.2 Named suites và lệnh tham khảo

Đường dẫn **[mới]** dưới đây là owning location dự kiến, không phải files hiện có hoặc checks đã chạy. I00/patch owner chốt tên thật trước khi chạy. Dùng scripts trong manifests; npm only, Python workspace lock, Go toolchain theo go.mod.

| Seam | Existing suites để chọn | Suite mới dự kiến |
|---|---|---|
| Schema/active slot/lifecycle intents | `apps/web/server/tests/runtime-context.test.ts`, `runtime-instances.test.ts`, `run-operations.test.ts`, `w11-controls.test.ts` | **[mới]** `project-environments.test.ts`, `environment-admission-live.ts` với DB thật |
| Runtime routing/SSE | `runtime-read-client.test.ts`, `stream-service.test.ts`, `runtime-context.test.ts` trong server tests | **[mới]** `runtime-environment-routing.test.ts` |
| Controller/provisioning | Go `internal/sandboxes`, `internal/opscontrol`, `internal/compose` theo module thực sự đổi | **[mới]** Go `internal/environments` tests nếu module này được chọn, plus Docker lifecycle harness |
| Runtime file/tool context | `packages/raptix/tests/unit/tools/bash/test_engagement_fence.py`, `test_sandbox_routing.py`; `unit/backends/test_http_sandbox.py`; `unit/middleware/test_opplan_persistence.py` | **[mới]** project-bound resume/restart graph regression tại owning package |
| CLI selection/history/restore | `apps/cli/src/hooks/useAgent.test.tsx`, `utils/apiUrl.test.ts` | **[mới]** `utils/projectSession.test.ts`, scoped client tests tại seam mới |
| Web flows | `apps/web/src/real/screens/workspace.test.tsx`, `precommit-regressions.test.tsx`, `app-routing.real.test.tsx`; `features/operations/runtime-tab.test.tsx` | **[mới]** project lifecycle rendered tests và browser acceptance script |
| Container/network config | `tests/test_compose_network_isolation.py` | **[mới]** owned Docker pair isolation/lifecycle fixture, không đọc data project khác |
| Migration/retention | Existing project/ownership/workflow owning tests sau inventory I00 | **[mới]** environment migration clean/upgrade/restore harness |

```powershell
# Menu, chọn đúng phase/changed seams, không chạy tất cả mỗi patch.
npm run build --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
npm run prisma:generate --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix
npm run typecheck --workspace=@raptix/cli

npm run test --workspace=@raptix/web-raptix-server -- --maxWorkers=2 tests/runtime-context.test.ts tests/runtime-read-client.test.ts tests/run-operations.test.ts
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=2 src/real/screens/workspace.test.tsx src/features/operations/runtime-tab.test.tsx
npm run test --workspace=@raptix/cli -- src/hooks/useAgent.test.tsx

uv run pytest -q packages/raptix/tests/unit/tools/bash/test_engagement_fence.py packages/raptix/tests/unit/tools/bash/test_sandbox_routing.py packages/raptix/tests/unit/middleware/test_opplan_persistence.py
uv run pytest -q tests/test_compose_network_isolation.py
# Chạy từ apps/launcher, chọn packages thực sự đổi; thêm module mới khi đã tồn tại.
go test ./internal/sandboxes ./internal/opscontrol ./internal/compose
```

Prisma generate không phải migrate. Schema migration chạy explicit trên dedicated DB và phải kiểm clean+upgrade+restart trước production cutover. Nếu chưa có môi trường DB/Docker/browser thì test fake không thay được acceptance: giữ case blocked với lý do và next action cụ thể.

### 8.3 Ma trận acceptance tối thiểu

| ID | Kịch bản | Pass signal | Phase sở hữu |
|---|---|---|---|
| E01 | Create/activate A, có image cache | Một runtime+sandbox đúng project; no per-project tools installation | I02/I08 |
| E02 | Mở A từ CLI và Web | Cùng canonical project/thread/output; không restart CLI hoặc sửa `.env` | I04/I05 |
| E03 | A busy; Web/CLI cùng activate B/C | Một winner/transition; không có hai project environments running | I01/I05/I06 |
| E04 | A→B→A | History/workspace riêng; old SSE/ACK không retarget; pending state không mất âm thầm | I03–I06 |
| E05 | File/network isolation | Direct path/traversal/symlink/peer HTTP/control API không vượt project; credential không lộ | I02/I09 |
| E06 | Restart runtime, rồi restart sandbox | Storage retained; process/outcomes đúng; không duplicate side effect | I06 |
| E07 | API/controller/laptop restart hoặc mất ACK giữa switch | Reconcile bền vững; không auto resume/all-project autostart; không release unknown slot | I01/I06 |
| E08 | Pause/question/retry recovery | Checkpoint continuation đúng identity; retry mới có lineage, guidance không chuyển attempt | I03/I06 |
| E09 | Archive/delete A, có B retained | Cleanup đúng labels/storage, policy được enforce; B/shared image/data không đổi | I06/I07 |
| E10 | Legacy CLI/Web cùng tên → migration | Không merge nhầm; bytes/IDs/history/ownership khớp mapping; unknown refused | I07 |
| E11 | Image update và rollback | Pin version/digest; state compatibility giữ; không dual writers/hidden re-execution | I07/I08 |
| E12 | Browser + TTY golden path, mock regression | Model/tool local thật → output → inspect/download/report theo scope; mock không provision | I09 |

Evidence E05 không đòi tạo nội dung nhạy cảm hoặc truy cập dữ liệu người dùng: dùng hai test projects với markers riêng và fake missing paths. Kiểm A và B lần lượt theo active admission; test peer HTTP/auth có thể dùng endpoint fixture thụ động và positive control từ trusted caller. Không bypass slot để chạy hai live project environments chỉ nhằm lấy isolation pass; orphan-process recovery là fault-injection có tên riêng. Số E01–E12 là acceptance IDs của tài liệu này, không phải target exploit objectives.

## 9. Definition of Done và bàn giao

- [ ] Web và CLI quản lý cùng canonical project/environment; cùng quyền và thread/run ownership.
- [ ] Project select/create/switch/restart/delete không yêu cầu restart client, sửa `.env`, copy folders hoặc manual Docker cleanup.
- [ ] Mỗi project dùng runtime+sandbox riêng; **chỉ một project environment active per deployment**, kể cả sau crash/timeout và nhiều clients cùng thao tác.
- [ ] Runtime/sandbox chỉ mount own workspace/state; inactive project vẫn có data/history theo retention.
- [ ] Network/control credentials không cho sandbox gọi peer/shared execution/runtime management; không có broad fallback hoặc Docker socket trong agent/API.
- [ ] Shared images/tools không bị nhân installation theo project; cached/offline paths và version pin được chứng minh.
- [ ] Scope/ROE/HITL/preflight/stop/approval semantics được giữ; activate environment không cấp execution authorization.
- [ ] Restart/resume/uncertain intents có observed outcomes và không duplicate side effects; pending questions/grants/attempt history được phục hồi đúng.
- [ ] Legacy data migration, restore và compatible rollback đã rehearsal; không silently remap hoặc clone shared state vào mọi project.
- [ ] Inactive source không thành giả empty/pass; global counts/search/recovery không tự start hidden runtimes.
- [ ] E01–E12 có evidence đúng source/tree/images/schema hoặc release vẫn open ở named requirement; full tests không thay actual boundary verification.
- [ ] Runbook, diagnostics và existing trackers/ADRs cập nhật; code cũ chỉ retire khi replacement/parity và rollback conditions đạt.

### Evidence record cho mỗi slice/acceptance

```text
phase / acceptance ID:
source SHA + working-tree digest / changed seam:
deploymentId / actor role / projectId / environmentId / generation:
runtime + sandbox + shared dependency image IDs/digests:
schema version / workspace + runtime-state refs (không secrets):
commandId / expectedVersion / threadId / runId / dispatchId / attempt:
selected suites + exact commands:
environment / UI URL / CLI invocation:
expected -> observed states / side-effect count / bytes/digest:
passed / failed / blocked + reason:
earlier evidence reused or invalidated:
cleanup / retained data / surviving processes / next action:
```

**Mốc bàn giao cuối:** operator chọn một project từ bất kỳ client nào, chạy trong đúng environment, quay lại tiếp tục sau stop/restart và quản lý/xóa đúng project mà không làm hỏng dữ liệu project khác. Shared deployment vẫn là nguồn cấu hình hạ tầng, không còn là nơi operator phải chỉnh project đang chạy.
