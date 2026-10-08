# Raptix Repository Architecture — Target Structure & Migration Plan

> Trạng thái: proposal chốt để triển khai.
>
> Phạm vi: cấu trúc repository, ranh giới package/module, dependency direction, vị trí UKC phase, skills/plugins/apps/infra/docs/tests.
>
> **Chưa đi sâu** vào luồng backend, AKG schema, Neo4j, database, event sourcing hoặc graph reasoning.

---

## 1. Mục tiêu refactor

Repo hiện tại có nền tảng tốt nhưng đang phình theo chiều ngang vì nhiều concern cùng nằm trong `packages/raptix`, đồng thời monorepo giữ nhiều product surface và domain chuyên biệt: runtime/orchestration, agents/prompts/LLM, middleware, sandbox/execution, tools, skills + skill engine + corpus, MCP/API, web/CLI/desktop/launcher, benchmark, telemetry và các domain như AD/cloud/web/mobile/IoT/ICS/wireless/reversing/contracts/phishing/DFIR.

Mục tiêu **không phải giảm số file bằng mọi giá**. Mục tiêu là làm rõ ownership để một developer hoặc coding agent có thể trả lời ngay:

1. Core contracts nằm ở đâu?
2. Runtime/orchestration nằm ở đâu?
3. UKC phase được quản lý ở đâu?
4. Agent/LLM/skills nằm ở đâu?
5. Tool execution/sandbox nằm ở đâu?
6. Domain-specific capability nằm ở đâu?
7. UI/app nằm ở đâu?
8. Infrastructure và benchmark nằm ở đâu?
9. Runtime artifact có bị lẫn với source code không?

---

## 2. Nguyên tắc kiến trúc

### 2.1 Giữ monorepo

Raptix vẫn nên là monorepo vì Python runtime, TypeScript clients và Go launcher cùng thuộc một sản phẩm; integration tests cần chạy xuyên nhiều service; shared contracts cần version đồng bộ; plugin/skill SDK phụ thuộc vào core contracts; deployment dùng chung Docker Compose.

### 2.2 Giữ ba package Python hiện có nhưng làm rõ vai trò

Hiện tại:

```text
packages/
├── raptix-core/
├── raptix/
└── raptix-sdk/
```

Target dài hạn:

```text
packages/
├── raptix-core/
├── raptix-runtime/
├── raptix-sdk/
└── raptix-skills/
```

Trong migration có thể giữ tên import/package `raptix` để tránh phá compatibility; chỉ rename thành `raptix-runtime` khi boundary đã ổn định.

### 2.3 UKC phase là orchestration state, không phải physical source tree

Không tổ chức toàn repo theo:

```text
initial_foothold/
network_propagation/
action_on_objectives/
```

UKC 3-phase chỉ thuộc:

```text
orchestration/phases/
```

Agent, skill và tool vẫn tổ chức theo capability/domain.

### 2.4 Domain-specific logic không thuộc core

Core runtime chỉ nên hiểu các abstraction như:

```text
Capability
Agent
Skill
Tool
Asset
Credential
Session
Evidence
Finding
Objective
Phase
```

Nó không nên phụ thuộc trực tiếp vào BloodHound, Certipy, Sliver, Ghidra, AWS, Kubernetes, Modbus, Evilginx, GoPhish, v.v.

### 2.5 Skills là knowledge/content, không phải core runtime

Các file `SKILL.md` là corpus kiến thức + metadata. Runtime chỉ nên giữ loader/registry/selector/engine/contracts.

### 2.6 Runtime artifact không thuộc source tree

Các thư mục như sau phải được coi là output:

```text
workspace/
run/
telemetry/
test-results*/
dist/
node_modules/
generated/
```

Không dùng chúng như source-of-truth.

---

# 3. Cấu trúc repository đích

```text
raptix/
│
├── apps/
│   ├── cli/
│   ├── web/
│   ├── desktop/
│   └── launcher/
│
├── packages/
│   ├── raptix-core/
│   ├── raptix-runtime/
│   ├── raptix-sdk/
│   └── raptix-skills/
│
├── plugins/
│   ├── web/
│   ├── network/
│   ├── active-directory/
│   ├── cloud/
│   ├── phishing/
│   ├── reversing/
│   ├── mobile/
│   ├── iot/
│   ├── ics/
│   ├── wireless/
│   └── contracts/
│
├── infra/
│   ├── containers/
│   ├── compose/
│   ├── config/
│   └── telemetry-gateway/
│
├── benchmarks/
│   ├── harness/
│   ├── scenarios/
│   ├── adapters/
│   ├── configs/
│   └── results/
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── engineering/
│   ├── features/
│   ├── integrations/
│   ├── migration/
│   ├── proposals/
│   ├── red-team/
│   ├── reports/
│   ├── security/
│   └── tools/
│
├── tests/
│   ├── integration/
│   ├── e2e/
│   ├── local/
│   └── fixtures/
│
├── scripts/
│
├── AGENTS.md
├── CLAUDE.md
├── CONTRIBUTING.md
├── SECURITY.md
├── SPEC.md
├── CHANGELOG.md
├── RELEASE.md
├── TELEMETRY.md
├── README.md
├── LICENSE
├── THIRD_PARTY_LICENSES.md
├── CODE_OF_CONDUCT.md
│
├── pyproject.toml
├── uv.lock
├── package.json
├── package-lock.json
├── Makefile
└── docker-compose.yml
```

---

# 4. `apps/`

Chứa các application entrypoint và user-facing clients.

```text
apps/
├── cli/
├── web/
├── desktop/
└── launcher/
```

## `apps/cli/`

Migrate từ `clients/cli/`.

Giữ:

- Ink/React TUI;
- command handlers;
- stream rendering;
- session UI;
- local UI state;
- CLI-specific API adapters.

Không chứa business/runtime logic.

## `apps/web/`

Migrate từ `clients/web-raptix/`.

Có thể giữ layout nội bộ hiện tại lúc đầu:

```text
apps/web/
├── src/
├── server/
├── tests/
└── tools/
```

`clients/web/` legacy không còn tồn tại như active app.

## `apps/desktop/`

Migrate từ `clients/desktop/`.

Chỉ là Electron shell, không sở hữu runtime/domain logic.

## `apps/launcher/`

Migrate từ `clients/launcher/`.

Giữ Go launcher + ops-control daemon cho install/start/stop/update/supervision/health/status.

---

# 5. `packages/raptix-core`

Target:

```text
packages/raptix-core/
└── raptix_core/
    ├── contracts/
    ├── protocols/
    ├── registry/
    ├── types/
    └── utils/
```

Chỉ chứa:

- dataclasses/types/enums;
- protocols/interfaces;
- plugin contribution contracts;
- capability contracts;
- registry contracts;
- safety contracts;
- engagement/scope types;
- phase types;
- tool/agent/skill protocols.

Không được import framework/runtime dependencies như:

```text
langchain
langgraph
fastapi
neo4j
httpx
docker
playwright
litellm
```

Dependency direction:

```text
raptix-core
↑
all other packages
```

---

# 6. `packages/raptix-runtime`

Framework + runtime chính.

Target:

```text
raptix/
├── orchestration/
├── knowledge/
├── intelligence/
├── execution/
├── middleware/
├── interfaces/
├── telemetry/
└── compat/
```

Trong migration có thể vẫn dùng Python import root `raptix`.

---

# 7. `orchestration/`

```text
orchestration/
├── mission/
├── planning/
├── phases/
└── dispatch/
```

## `mission/`

Ownership:

- engagement/mission context;
- objective;
- lifecycle start/stop/resume;
- mission-level state abstraction;
- references tới scope/policy.

## `planning/`

Ownership:

- planning context;
- candidate action/transition abstraction;
- ranking/scoring;
- plan selection;
- strategic planning abstraction.

Planner chọn intent/capability, không hard-code tool command.

## `phases/`

Target:

```text
phases/
├── model.py
├── state_machine.py
├── policy.py
├── transition.py
└── ukc.py
```

Canonical UKC macro-phase:

```text
INITIAL_FOOTHOLD
NETWORK_PROPAGATION
ACTION_ON_OBJECTIVES
```

Phase là runtime state, không phải agent folder hoặc skill folder.

## `dispatch/`

Ownership:

```text
planner decision
→ capability resolution
→ skill/agent resolution
→ execution request
```

---

# 8. `knowledge/`

> Tài liệu này chỉ chốt vị trí/ownership; chưa đi sâu graph/database.

```text
knowledge/
├── graph/
├── findings/
├── evidence/
└── events/
```

Ownership tổng thể:

- canonical knowledge/state abstraction;
- findings lifecycle;
- evidence metadata;
- event/audit abstraction;
- query/reasoning facade cho orchestration.

Điểm kiến trúc phải chốt:

```text
middleware/kg_internal/
```

không còn là owner của graph subsystem.

Graph thuộc:

```text
knowledge/graph/
```

Middleware chỉ gọi vào subsystem này.

---

# 9. `intelligence/`

```text
intelligence/
├── agents/
├── prompts/
├── skills/
└── llm/
```

## `agents/`

Migrate ownership từ:

```text
agents/standard/
agents/plugins/
agents/build.py
agents/task_spec.py
```

Agent tổ chức theo role/domain, không theo UKC phase.

## `prompts/`

Migrate từ `agents/prompts/`.

Chứa role prompts, workflow prompts, prompt builder và compatibility adapters.

## `llm/`

Migrate từ `llm/`.

Chứa model factory, provider abstraction, router, model selection, fallback/rate controls.

Các file provider implementation hiện ở root `config/*.py` nên dần move về:

```text
intelligence/llm/providers/
```

Root config sau đó chỉ giữ YAML/env/deployment config.

## `skills/`

Runtime skill layer:

```text
skills/
├── loader.py
├── registry.py
├── selector.py
├── metadata.py
└── engine/
```

Không chứa toàn bộ skill corpus sau khi migration hoàn tất.

---

# 10. `execution/`

```text
execution/
├── tools/
├── sandbox/
├── sessions/
└── backends/
```

## `tools/`

Migrate từ `tools/`.

Ban đầu có thể giữ domain folders hiện tại. Về lâu dài generic tools ở runtime, domain-specific tools dần move sang plugins.

## `sandbox/`

Gom:

```text
sandbox_kernel/
sandbox_server/
sandbox_web/
```

thành:

```text
sandbox/
├── kernel/
├── server/
└── web/
```

## `sessions/`

Ownership cho:

- long-lived terminal sessions;
- tmux sessions;
- interactive jobs;
- execution lifecycle;
- persistent command sessions.

## `backends/`

Migrate từ `backends/`.

Chứa execution backend abstraction/implementation.

---

# 11. `middleware/`

Middleware chỉ chứa cross-cutting concerns.

Target ví dụ:

```text
middleware/
├── scope.py
├── budget.py
├── hitl.py
├── egress.py
├── audit.py
├── graph_context.py
├── graph_ingest.py
├── model_override.py
├── notifications.py
├── prompt_injection.py
└── ...
```

Không được chứa một subsystem lớn như `kg_internal/`.

---

# 12. `interfaces/`

```text
interfaces/
├── api/
└── mcp/
```

## `mcp/`

Migrate từ `mcp_server/`.

Chứa transport/protocol-facing code, không chứa business logic.

## `api/`

Migrate từ `server/` và các runtime-facing API entrypoint phù hợp.

---

# 13. `telemetry/`

Giữ runtime observability.

`telemetry-gateway/` là deployable infrastructure/service riêng; target:

```text
infra/telemetry-gateway/
```

---

# 14. `packages/raptix-sdk`

Giữ gần như nguyên trạng:

```text
raptix-sdk/
├── raptix_sdk/
│   ├── scaffold/
│   └── testing/
├── examples/
└── tests/
```

SDK là public API cho plugin author.

Plugin không được import private runtime internals.

---

# 15. `packages/raptix-skills`

Tách skill corpus khỏi runtime.

Target:

```text
raptix-skills/
├── skills/
│   ├── shared/
│   ├── recon/
│   ├── web/
│   ├── network/
│   ├── active-directory/
│   ├── post-exploit/
│   ├── cloud/
│   ├── phishing/
│   ├── reversing/
│   ├── mobile/
│   ├── iot/
│   ├── ics/
│   ├── wireless/
│   └── ...
├── references/
└── pyproject.toml
```

Nếu corpus không cần Python packaging, phương án thay thế là `content/skills/`, nhưng package riêng phù hợp hơn với versioning/audit/test/distribution hiện tại.

---

# 16. UKC metadata trong skills

Không tạo:

```text
skills/initial_foothold/
skills/network_propagation/
skills/action_on_objectives/
```

Skill giữ domain structure nhưng có metadata:

```yaml
name: credential-reuse

capabilities:
  - credential_access
  - lateral_movement

ukc_phases:
  - network_propagation

requires:
  - credential
  - reachable_service

produces:
  - session
  - evidence
```

Một skill có thể thuộc nhiều phase.

---

# 17. `plugins/`

Target dài hạn:

```text
plugins/
├── web/
├── network/
├── active-directory/
├── cloud/
├── phishing/
├── reversing/
├── mobile/
├── iot/
├── ics/
├── wireless/
└── contracts/
```

Một plugin có thể chứa:

```text
active-directory/
├── agents/
├── tools/
├── skills/
├── prompts/
├── plugin.toml
└── tests/
```

Plugin đăng ký capability/agent/tool/skill/prompt qua SDK/core contracts.

### Pluginization order

Move trước các domain ít coupling:

```text
contracts
reversing
mobile
iot
ics
wireless
```

Move sau:

```text
cloud
phishing
active-directory
web
network
```

---

# 18. `infra/`

```text
infra/
├── containers/
├── compose/
├── config/
└── telemetry-gateway/
```

## `containers/`

Migrate từ `containers/`.

## `compose/`

Migrate các compose file root:

```text
infra/compose/
├── base.yml
├── dev.yml
├── watch.yml
├── opscontrol.yml
└── web.yml
```

Có thể giữ root `docker-compose.yml` dạng thin entrypoint để giữ developer UX.

## `config/`

Sau migration chỉ giữ configuration, không giữ provider implementation Python.

---

# 19. `benchmarks/`

Target:

```text
benchmarks/
├── harness/
├── scenarios/
├── adapters/
├── configs/
└── results/
```

`harness/`: generic runner/scoring/measurement.

`scenarios/`: scenario/lab thực sự sử dụng.

`adapters/`: adapter tới local lab, GOAD, custom multi-host scenario hoặc benchmark ngoài.

`results/`: chỉ giữ curated summary/small fixtures/reproducibility metadata; raw large artifacts không commit.

---

# 20. `docs/`

Chỉ có **một docs tree authoritative**.

```text
docs/
├── architecture/
├── adr/
├── engineering/
├── features/
├── integrations/
├── migration/
├── proposals/
├── red-team/
├── reports/
├── security/
└── tools/
```

## `docs/architecture/`

```text
architecture/
├── repository-structure.md
├── system-context.md
├── container-view.md
├── runtime-boundaries.md
├── dependency-rules.md
├── ukc-phase-model.md
├── skills-and-capabilities.md
└── plugins.md
```

## `docs/adr/`

Ví dụ:

```text
ADR-001-monorepo-boundaries.md
ADR-002-core-runtime-sdk-split.md
ADR-003-ukc-phase-is-runtime-state.md
ADR-004-skill-corpus-separation.md
ADR-005-domain-plugin-packs.md
ADR-006-legacy-web-retirement.md
```

ADR giải thích **tại sao**; architecture docs mô tả **current target state**.

## `docs/migration/`

Chứa migration plan/status theo wave.

Không để tài liệu migration dài hạn sống sâu trong app-specific docs.

---

# 21. `tests/`

Target top-level:

```text
tests/
├── integration/
├── e2e/
├── local/
└── fixtures/
```

Package-specific unit tests vẫn nằm cạnh package:

```text
packages/raptix-core/tests/
packages/raptix-runtime/tests/
packages/raptix-sdk/tests/
plugins/*/tests/
```

Top-level `tests/` chỉ giữ cross-package/system tests.

---

# 22. Runtime artifacts

Target có thể gom về:

```text
.var/
├── workspace/
├── run/
├── telemetry/
└── test-results/
```

Nếu chưa muốn đổi path, có thể giữ folder hiện tại nhưng bắt buộc:

- gitignored;
- không import như source;
- không làm fixture mặc định;
- CI artifact upload riêng.

---

# 23. Root cleanup

Root chỉ giữ project-wide files.

Move:

```text
ARCHITECTURE_AUDIT.md
ARCHITECTURE_AUDIT_FIX.md
```

sang:

```text
docs/architecture/audits/
```

`prompt.txt`, `bp.json` phải xác định ownership:

- dev-only → `tools/` hoặc `docs/dev/`;
- config → `infra/config/`;
- obsolete → xóa.

---

# 24. Legacy web cleanup

Current:

```text
clients/web/
clients/web-raptix/
```

Target:

```text
apps/web/
```

`clients/web/` legacy/reference-only nên bị remove khỏi main tree sau khi tag commit lịch sử.

Không nên giữ hai active-looking web app lâu dài.

---

# 25. Generated code và test artifacts

Các folder:

```text
dist/
node_modules/
generated/prisma/
test-results*/
```

mặc định không phải source-of-truth.

Nếu generated Prisma client cần commit vì tooling constraint, phải document exception rõ ràng.

---

# 26. Dependency direction

```text
                     Apps
            CLI / Web / Desktop / MCP
                      │
                      ▼
                Raptix Runtime
      ┌───────────────┼────────────────┐
      ▼               ▼                ▼
Orchestration     Intelligence      Execution
      │               │                │
      └───────────────┼────────────────┘
                      ▼
                  Knowledge
                      │
                      ▼
                 Raptix Core
```

Plugin packs:

```text
Plugins
   ├── depend on SDK
   └── depend on Core contracts
```

Skills:

```text
Raptix Skills
   └── consumed through runtime skill loader/registry
```

---

# 27. Dependency rules bắt buộc

1. `raptix-core` không import runtime.
2. `raptix-sdk` không import private runtime modules.
3. Apps không import deep runtime internals.
4. Plugin chỉ import SDK/core contracts.
5. Skills không import Python runtime implementation.
6. Middleware không sở hữu subsystem state.
7. UKC phase không được hard-code trong tool implementation.
8. Domain-specific code không được thêm trực tiếp vào core nếu có thể implement bằng plugin/capability.
9. Runtime artifacts không được git-track.
10. Legacy app không được giữ như active surface.

---

# 28. UKC adaptation trong repo

UKC chỉ thêm ownership sau:

```text
packages/raptix-runtime/
└── raptix/
    └── orchestration/
        └── phases/
            ├── model.py
            ├── state_machine.py
            ├── policy.py
            ├── transition.py
            └── ukc.py
```

Không tạo mặc định:

```text
InitialFootholdAgent
NetworkPropagationAgent
ActionOnObjectivesAgent
```

Không copy skills/tools theo phase.

Phase chỉ ảnh hưởng:

- planner context;
- capability selection;
- skill eligibility;
- transition policy;
- UI/status presentation.

---

# 29. Target runtime tree hoàn chỉnh

```text
packages/raptix-runtime/
├── raptix/
│   ├── orchestration/
│   │   ├── mission/
│   │   ├── planning/
│   │   ├── phases/
│   │   └── dispatch/
│   │
│   ├── knowledge/
│   │   ├── graph/
│   │   ├── findings/
│   │   ├── evidence/
│   │   └── events/
│   │
│   ├── intelligence/
│   │   ├── agents/
│   │   ├── prompts/
│   │   ├── skills/
│   │   └── llm/
│   │
│   ├── execution/
│   │   ├── tools/
│   │   ├── sandbox/
│   │   │   ├── kernel/
│   │   │   ├── server/
│   │   │   └── web/
│   │   ├── sessions/
│   │   └── backends/
│   │
│   ├── middleware/
│   ├── interfaces/
│   │   ├── api/
│   │   └── mcp/
│   ├── telemetry/
│   ├── compat/
│   ├── plugin_loader.py
│   └── __init__.py
│
├── tests/
├── pyproject.toml
└── README.md
```

---

# 30. Migration mapping từ current repo

## Top-level

| Current | Target |
|---|---|
| `clients/cli` | `apps/cli` |
| `clients/web-raptix` | `apps/web` |
| `clients/desktop` | `apps/desktop` |
| `clients/launcher` | `apps/launcher` |
| `clients/web` | remove/archive |
| `containers` | `infra/containers` |
| `config` | split: `infra/config` + runtime LLM provider implementation |
| `benchmark` | `benchmarks` |
| `telemetry-gateway` | `infra/telemetry-gateway` |
| `assets` | app/docs-specific assets hoặc `docs/assets` |
| `integrations` | evaluate → plugin/docs/compat |
| `workspace/run/telemetry` | runtime `.var/` hoặc giữ gitignored |

## Runtime package

| Current | Target |
|---|---|
| `agents/standard` | `intelligence/agents` |
| `agents/plugins` | `intelligence/agents` hoặc plugin packs |
| `agents/prompts` | `intelligence/prompts` |
| `llm` | `intelligence/llm` |
| `skills/engine` | `intelligence/skills/engine` |
| `skills/defs` | `packages/raptix-skills` |
| `backends` | `execution/backends` |
| `sandbox_kernel` | `execution/sandbox/kernel` |
| `sandbox_server` | `execution/sandbox/server` |
| `sandbox_web` | `execution/sandbox/web` |
| `tools` | `execution/tools` rồi plugin hóa dần |
| `middleware/kg_internal` | `knowledge/graph` |
| `runtime/event_log` | `knowledge/events` hoặc runtime audit boundary |
| `mcp_server` | `interfaces/mcp` |
| `server` | `interfaces/api` |
| `telemetry` | giữ `telemetry` |
| `blue_cell` | plugin/capability subsystem; không core mặc định |
| `capabilities` | contracts về core, runtime logic về orchestration/intelligence tùy ownership |

---

# 31. Các phần chưa cần migrate ngay

Không cần big-bang.

Tạm giữ nguyên internal layout của:

- CLI;
- web features;
- Go launcher;
- SDK examples;
- all domain tools;
- all skill files;
- all prompts;
- plugin system internals.

Trước tiên chỉ tạo boundary mới và compatibility shims.

---

# 32. Implementation waves

## W0 — Baseline freeze

- tag current commit;
- run unit tests;
- run integration tests;
- run web smoke;
- run compose smoke;
- record dependency graph.

Không đổi behavior.

## W1 — Repo hygiene

- archive/remove legacy `clients/web`;
- remove committed test-results;
- move architecture audit docs;
- cleanup root temporary files;
- thống nhất runtime output ignore;
- hợp nhất docs ownership.

Không đổi behavior.

## W2 — Introduce target top-level layout

Tạo:

```text
apps/
infra/
benchmarks/
```

Move clients/infrastructure với compatibility scripts nếu cần.

## W3 — Runtime subsystem boundaries

Trong package `raptix`, tạo:

```text
orchestration/
knowledge/
intelligence/
execution/
interfaces/
```

Ban đầu dùng re-export compatibility.

## W4 — Extract knowledge subsystem

Move ownership:

```text
middleware/kg_internal
→ knowledge/graph
```

Middleware chỉ còn thin adapters.

Chi tiết graph/database xử lý ở tài liệu riêng.

## W5 — Move agent/LLM/prompt ownership

```text
agents → intelligence/agents
agents/prompts → intelligence/prompts
llm → intelligence/llm
```

Không đổi prompt behavior.

## W6 — Move execution ownership

```text
backends → execution/backends
sandbox_* → execution/sandbox/*
tools → execution/tools
```

Giữ compatibility imports.

## W7 — Introduce UKC orchestration structure

Tạo:

```text
orchestration/phases/
```

Định nghĩa ba macro-phase. Ban đầu chỉ shadow/status mode nếu cần.

## W8 — Skill metadata migration

Thêm optional metadata:

```text
capabilities
ukc_phases
requires
produces
```

Legacy skill không metadata vẫn chạy.

## W9 — Split skill corpus

Move:

```text
skills/defs/
→ packages/raptix-skills/
```

Runtime chỉ giữ loader/registry/selector/engine.

## W10 — Domain plugin extraction

Move dần các domain có boundary sạch, sau đó mới tới AD/web/network.

## W11 — Remove compatibility layer

Chỉ làm khi imports mới ổn định, tests green, docs update và plugin API stable.

---

# 33. Không được refactor theo cách sau

### Không big-bang rename toàn repo

Không cùng lúc move folder + đổi imports + đổi runtime flow + đổi graph schema + đổi prompt + đổi skills + đổi phase engine.

### Không giữ duplicate implementation lâu dài

Không để cả:

```text
agents/
intelligence/agents/
```

với hai implementation song song. Compatibility chỉ re-export.

### Không plugin hóa trước khi SDK/core contract ổn

Nếu public contract chưa đủ, pluginization sẽ tạo dependency ngược.

### Không tổ chức skills theo UKC tree

UKC là metadata/runtime filtering.

### Không để web/server trở thành second backend

Web server là control plane/API/projection layer; business runtime vẫn thuộc Python runtime.

---

# 34. Naming conventions

Python package dùng `snake_case`.

Repo-level domain folder có thể dùng kebab-case, ví dụ:

```text
active-directory/
```

Python import:

```text
active_directory
```

Chọn một canonical name; không trộn `ad`, `active_directory`, `active-directory` trong cùng abstraction trừ compatibility layer.

---

# 35. Ownership rules cho coding agent

Mỗi subsystem nên có README/AGENTS cục bộ ngắn, ví dụ:

```text
packages/raptix-runtime/raptix/orchestration/README.md
```

Nội dung:

- responsibility;
- allowed imports;
- forbidden imports;
- public interfaces;
- tests;
- authoritative docs.

Coding agent trước khi sửa subsystem phải đọc file này.

---

# 36. Repo invariants

Có thể machine-check dần:

```yaml
repo_invariants:
  core_has_no_runtime_dependencies: true
  sdk_does_not_import_runtime_internals: true
  apps_do_not_import_private_runtime_modules: true
  middleware_does_not_own_subsystems: true
  skills_are_content_not_runtime_state: true
  ukc_phase_is_orchestration_state: true
  plugins_use_sdk_or_core_contracts_only: true
  runtime_artifacts_are_not_git_tracked: true
  legacy_web_is_not_active_application: true
```

---

# 37. Architecture docs authoritative cho coding agent

Root `AGENTS.md` chỉ nên chứa:

- cách navigate repo;
- mandatory architecture docs;
- test commands;
- forbidden dependency directions.

Source-of-truth:

```text
docs/architecture/
├── repository-structure.md
├── dependency-rules.md
├── runtime-boundaries.md
├── ukc-phase-model.md
├── skills-and-capabilities.md
└── plugins.md
```

ADR giải thích quyết định lịch sử; architecture docs mô tả target/current architecture.

---

# 38. Cấu trúc tối giản để đưa vào báo cáo

```text
Raptix
├── Applications
│   ├── CLI
│   ├── Web
│   ├── Desktop
│   └── Launcher
│
├── Runtime
│   ├── Orchestration
│   ├── Knowledge
│   ├── Intelligence
│   ├── Execution
│   ├── Middleware
│   └── Interfaces
│
├── Core
│   ├── Contracts
│   ├── Protocols
│   └── Types
│
├── SDK
├── Skills
├── Plugins
├── Infrastructure
└── Benchmarks
```

---

# 39. Definition of Done

Refactor cấu trúc repo được coi là hoàn tất khi:

- [ ] chỉ còn một active web app;
- [ ] app clients nằm dưới `apps/`;
- [ ] infra nằm dưới `infra/`;
- [ ] benchmark nằm dưới `benchmarks/`;
- [ ] runtime có boundary rõ: orchestration / knowledge / intelligence / execution / middleware / interfaces;
- [ ] `kg_internal` không còn nằm dưới middleware;
- [ ] agents/prompts/llm thuộc intelligence;
- [ ] sandbox/tools/backends thuộc execution;
- [ ] UKC nằm trong orchestration;
- [ ] skill corpus không còn làm runtime package phình;
- [ ] domain plugins dùng public SDK/core boundary;
- [ ] runtime artifacts không được git-track;
- [ ] docs có một architecture source-of-truth;
- [ ] dependency rules có test/lint enforcement;
- [ ] compatibility shims cuối cùng được xóa;
- [ ] unit/integration/e2e tests vẫn green.

---

# 40. Migration priority

```text
P0 — architecture hygiene
    legacy removal
    docs ownership
    artifacts cleanup

P1 — subsystem boundaries
    orchestration
    knowledge
    intelligence
    execution
    interfaces

P2 — UKC phase ownership
    orchestration/phases
    skill metadata

P3 — skill corpus separation

P4 — domain plugin extraction

P5 — compatibility removal
```

Không đảo P3/P4 lên trước P1/P2.

---

# 41. Kiến trúc chốt

Top-level:

```text
raptix/
├── apps/
├── packages/
│   ├── raptix-core/
│   ├── raptix-runtime/
│   ├── raptix-sdk/
│   └── raptix-skills/
├── plugins/
├── infra/
├── benchmarks/
├── docs/
├── tests/
└── scripts/
```

Runtime:

```text
raptix/
├── orchestration/
├── knowledge/
├── intelligence/
├── execution/
├── middleware/
├── interfaces/
└── telemetry/
```

UKC:

```text
orchestration/
└── phases/
    ├── INITIAL_FOOTHOLD
    ├── NETWORK_PROPAGATION
    └── ACTION_ON_OBJECTIVES
```

UKC là **runtime state**, không phải physical source tree.

Đây là target repository architecture dùng làm baseline trước khi tiếp tục thiết kế sâu backend, AKG, database và graph reasoning.
