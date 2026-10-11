# graph optim

> **Note (2026-10-11):** largely superseded by
> [ADR-0049](adr/0049-evidence-model-extends-capability-contract.md) — this
> document predates the W16–W18 restructuring (ADR-0040/0041) that resolved
> its §25 complaint, and its AKG schema-collapse proposal was found to be a
> regression relative to the current `NodeKind` schema. Read ADR-0049 first.

## Response:
05/10/2026, 11:49:17 · gpt-5-6-thinking

Dưới đây là bản **chốt toàn bộ quan điểm về việc sử dụng graph trong Raptix** mà chúng ta đã thống nhất. Nó kết hợp cả hướng AKG trong báo cáo và những gì repo hiện tại đang có: `raptix_core/types/kg.py`, `middleware/kg_internal`, migrations Neo4j, `tools/research/graph.py`, `tools/reporting/kg_adapter.py`, Skillogy dùng Neo4j và các test KG live. `repo-structure.txt`

# 1. Graph đóng vai trò gì trong Raptix?

Graph không chỉ để visualization.

Vai trò chính của **Attack Knowledge Graph - AKG** là trở thành:

> **canonical semantic state của một engagement Red Team.**

Nó phải trả lời được các câu hỏi như:

```text
Ta biết những asset nào?
Service nào đang chạy trên asset nào?
Ta có credential nào?
Credential đó thuộc identity nào?
Ta đang có quyền truy cập thật vào host nào?
Finding nào đã được xác minh?
Evidence nào chứng minh finding đó?
Action nào đã tạo ra evidence?
Từ foothold hiện tại có những attack path nào?
Ta đã thử nhánh nào rồi?
Objective hiện tại có thể đạt bằng đường nào?
```

Vì vậy graph là lớp:

```text
OBSERVED STATE
      +
RELATIONSHIPS
      +
PROVENANCE
      +
PLANNING CONTEXT
```

chứ không phải chỉ là nơi lưu `host -> vulnerability`.

---

# 2. Không phải mọi dữ liệu đều nhét vào Neo4j

Đây là điểm rất quan trọng.

Chúng ta thống nhất kiến trúc hybrid:

```text
Graph
= WHAT + RELATIONSHIP + STATE + PROVENANCE

Artifact
= CONTENT
```

Neo4j giữ:

```text
entity
metadata
state
relationship
identity/reference
provenance
```

Artifact store giữ:

```text
Markdown
stdout
HTTP response
JSON
screenshots
PCAP
terminal recording
raw logs
report
binary evidence
```

Ví dụ:

```text
(:Finding {
    id: "F-001",
    title: "Credential reuse",
    severity: "high",
    status: "verified",
    markdown_ref: "findings/F-001.md"
})
```

Còn nội dung mà con người đọc:

```text
findings/F-001.md
```

Evidence cũng tương tự:

```text
(:Evidence {
    id: "E-014",
    mime_type: "text/plain",
    artifact_ref: "evidence/E-014.txt",
    sha256: "..."
})
```

Như vậy UI hoàn toàn có thể mở Finding dưới dạng Markdown, nhưng graph vẫn có structured representation để reasoning.

---

# 3. Graph node không có nghĩa là nội dung nằm toàn bộ trong node

Một node `Finding` không phải chính file Markdown.

Nó là **machine representation**:

```text
Finding
- id
- title
- type
- severity
- confidence
- status
- affected entity
- evidence references
- created_by
- created_at
- artifact_ref
```

File Markdown là **human representation**:

```text
F-001.md

# Credential reuse

## Summary
...

## Evidence
...

## Impact
...

## Remediation
...
```

Tương tự:

```text
Evidence node
        │
        └── artifact_ref
               │
               ▼
        E-014.txt/png/json
```

Markdown không nên là canonical state.

---

# 4. Canonical node model của AKG

Schema chúng ta đã thống nhất nên xoay quanh các entity sau:

| Node | Vai trò |
|---|---|
| `Engagement` | Một mission / red-team engagement |
| `Objective` | Mục tiêu cuối hoặc intermediate objective |
| `Asset` | Host, application, device hoặc logical target |
| `Service` | HTTP, SSH, SMB, LDAP, database service... |
| `Identity` | User, account, machine account, group, role |
| `Credential` | Password, hash, ticket, key, token, cookie |
| `Session` | Quyền truy cập thực sự đang tồn tại vào asset |
| `Vulnerability` | CVE, misconfiguration, logic flaw |
| `Finding` | Security conclusion có lifecycle |
| `Action` | Một hành động/tool execution |
| `Evidence` | Bằng chứng sinh ra từ execution |

Điểm khác biệt lớn so với thiết kế cũ là **giảm các node mang tính khái niệm mơ hồ**.

---

# 5. `Foothold` không nên là node

Trước đây báo cáo có lúc coi `Foothold` là node riêng.

Chúng ta đã chốt:

> **Foothold là một `Session` đã được xác minh.**

Ví dụ:

```text
(:Session {
    id: "S-001",
    kind: "shell",
    status: "verified",
    privilege_level: "user"
})
```

với:

```text
(Session)-[:ON_ASSET]->(Asset)

(Session)-[:AS_IDENTITY]->(Identity)
```

Khi tồn tại verified session trên host:

```text
→ ta có foothold.
```

Điều này làm graph sạch hơn rất nhiều.

---

# 6. `Privilege` cũng không nên là node mặc định

Không cần:

```text
(:Privilege {name: "root"})
```

nếu nhu cầu hiện tại chỉ là:

```text
user
admin
root
SYSTEM
domain-admin
```

Privilege có thể nằm trong:

```text
Session.privilege_level
```

hoặc access relation.

Ví dụ:

```text
(Session {
    privilege_level: "root"
})
```

Chỉ khi Raptix sau này cần reason sâu về RBAC/ACL, privilege hierarchy, policy inheritance... thì mới cân nhắc `Privilege` như first-class node.

---

# 7. Relationship cũng phải có semantics rõ

Không nên tạo quá nhiều edge mơ hồ như:

```text
YIELDS
LEADS_TO
EXPLOITABLE_VIA
```

rồi để mỗi module hiểu một kiểu.

Các relation canonical nên gần với fact thực tế.

Ví dụ topology:

```text
Asset ──EXPOSES──────→ Service
Asset ──CONNECTED_TO─→ Asset
```

Identity/access:

```text
Credential ──AUTHENTICATES_AS─→ Identity

Identity ──MEMBER_OF─→ Identity

Session ──ON_ASSET───────→ Asset
Session ──AS_IDENTITY─────→ Identity
Session ──USING_CREDENTIAL→ Credential
```

Exploitation:

```text
Vulnerability ──AFFECTS─→ Service/Asset

Action ──TARGETED───────→ Asset/Service
Action ──EXPLOITED──────→ Vulnerability
Action ──CREATED_SESSION→ Session
```

Provenance:

```text
Action ──PRODUCED──→ Evidence

Evidence ──SUPPORTS→ Finding

Finding ──AFFECTS─→ Asset/Service

Action ──DISCOVERED→ Asset/Service/Identity/Credential
```

---

# 8. Tránh lưu cùng một fact hai lần

Ví dụ nếu đã có:

```text
Asset ──EXPOSES→ Service
```

thì thường không cần thêm:

```text
Service ──RUNS_ON→ Asset
```

vì hai edge biểu diễn cùng một fact.

Có thể query inverse relation khi cần.

Nguyên tắc:

> **Một fact → một canonical representation.**

Điều này giảm inconsistency.

---

# 9. Fact và inference phải khác nhau

Đây là một trong những nguyên tắc quan trọng nhất của AKG mới.

Không được biến suy luận của LLM thành fact.

Ví dụ đã biết:

```text
Credential svc_backup
```

không có nghĩa rằng:

```text
svc_backup CAN_AUTH fs01
```

là fact.

Flow đúng phải là:

```text
FACT
 ↓
INFERENCE
 ↓
ATTEMPT
 ↓
OBSERVATION
 ↓
NEW FACT
```

Ví dụ:

```text
Credential
     │
     ▼
Graph reasoner:
"có khả năng credential reuse tới fs01"
     │
     ▼
CandidateTransition
     │
     ▼
tool execution
     │
     ▼
authentication SUCCESS
     │
     ▼
Session(fs01)
```

Chỉ `Session(fs01)` mới trở thành verified fact.

---

# 10. Không nên persist mọi inference vào graph

Các relation như:

```text
CAN_AUTH
CAN_PIVOT
CAN_ESCALATE
CAN_REACH
```

rất hữu ích cho planner.

Nhưng ban đầu chúng nên được **derive từ canonical graph** chứ không phải lưu thành permanent fact.

Ví dụ:

```text
Canonical AKG
     ↓
GraphReasoner
     ↓
CandidateTransition[]
```

Candidate có thể chứa:

```text
kind: credential_reuse
source: web01
target: fs01
confidence: 0.83
cost: 2
opsec_risk: 0.2
```

Nếu sau này performance yêu cầu, derived relation có thể cache/persist.

Nhưng đó là optimization, không phải source of truth.

---

# 11. `Action` là node cực kỳ quan trọng

Trước đây graph thường xoay quanh asset/vulnerability.

Raptix nên coi `Action` là first-class entity.

Ví dụ:

```text
Action
- id
- engagement_id
- agent_id
- phase
- capability
- skill_id
- tool
- started_at
- completed_at
- status
```

Graph:

```text
Action
 ├── TARGETED────→ Asset
 ├── USED────────→ Credential
 ├── PRODUCED────→ Evidence
 ├── CREATED─────→ Session
 └── DISCOVERED──→ Entity
```

Nhờ `Action`, ta có provenance đầy đủ.

---

# 12. Provenance chain phải truy ngược được

Một verified finding cần truy ngược được:

```text
Finding
   ↑
SUPPORTS
   │
Evidence
   ↑
PRODUCED
   │
Action
   │
   └── tool execution
```

Tức là:

```text
Finding
→ Evidence
→ Action
→ Tool execution
```

Nếu không truy được chain này, finding chưa đáng tin cậy.

Đây cũng là cơ sở cho:

```text
audit
replay
verification
reporting
debugging
```

---

# 13. Evidence nên immutable

Sau khi `Evidence` được ghi:

```text
E-001.txt
E-002.png
E-003.json
```

không nên chỉnh nội dung.

Node Evidence lưu:

```text
artifact_ref
sha256
mime_type
size
created_at
action_id
```

Finding Markdown có thể edit.

Report có thể regenerate.

Nhưng raw evidence nên immutable.

---

# 14. Finding có lifecycle rõ ràng

Lifecycle đã thống nhất:

```text
CANDIDATE
    ↓
VALIDATED
    ↓
VERIFIED
    ↓
REPORTED
```

Ý nghĩa:

```text
candidate
tool/LLM nghi ngờ tồn tại

validated
evidence đủ để verifier tiến hành kiểm tra

verified
được verifier/oracle xác nhận

reported
đã đưa vào deliverable
```

Đây là property/state của cùng một `Finding` node.

Không phải:

```text
CandidateFinding node
VerifiedFinding node
ReportedFinding node
```

---

# 15. UKC phase không phải graph node

Không tạo:

```text
(:InitialFoothold)
(:NetworkPropagation)
(:ActionOnObjectives)
```

UKC thuộc:

```text
orchestration/phases/
```

Graph chỉ cung cấp state cho phase engine.

Ví dụ:

```text
AKG
 ↓
PhaseContext
 ↓
PhasePolicy
 ↓
PhaseEngine
```

3 phase:

```text
INITIAL_FOOTHOLD

NETWORK_PROPAGATION

ACTION_ON_OBJECTIVES
```

---

# 16. Graph là input của Phase Engine

Ví dụ phase engine có thể hỏi AKG:

```text
Có verified session chưa?

Objective nằm ở đâu?

Từ session hiện tại có reachable asset nào?

Credential nào đang available?

Có attack path khả thi tới objective không?
```

Sau đó mới quyết định transition.

Ví dụ:

```text
INITIAL_FOOTHOLD
      │
      │ verified Session exists
      ▼
NETWORK_PROPAGATION
      │
      │ objective prerequisites satisfied
      ▼
ACTION_ON_OBJECTIVES
```

Phase transition không nên do LLM tự tuyên bố.

---

# 17. Không quay lại Initial Foothold chỉ vì phát hiện subnet mới

Đây là một điều chúng ta đã điều chỉnh so với ý tưởng ban đầu.

Nếu đang:

```text
NETWORK_PROPAGATION
```

và pivot qua host mới rồi phát hiện subnet mới, không có nghĩa là quay lại:

```text
INITIAL_FOOTHOLD
```

Ta vẫn đang ở:

```text
NETWORK_PROPAGATION
```

nhưng planner chọn capability:

```text
internal_discovery
```

Initial Foothold về semantics là đạt initial access.

Không phải mọi vòng reconnaissance đều là Initial Foothold.

---

# 18. Planner không được raw-query Neo4j

Planner/LLM không nên có:

```text
MATCH (n)-[*]->(...)
```

tùy ý.

Thay vào đó:

```text
Neo4j
   ↓
Graph repository
   ↓
Graph query service
   ↓
structured DTO
   ↓
Planner
```

Ví dụ planner nhận:

```text
PhaseContext
- current_phase
- verified_sessions
- credentials
- reachable_assets
- objectives
- failed_attempts
```

Điều này mang lại ba lợi ích:

```text
planner không phụ thuộc Neo4j schema
context nhỏ hơn
graph access có thể kiểm soát
```

---

# 19. Attack-path reasoning không nên chạy trực tiếp trên toàn heterogeneous graph

AKG có:

```text
Asset
Service
Identity
Credential
Session
Finding
Evidence
Action
...
```

Nếu chạy shortest-path trực tiếp trên graph đó, đường đi có thể không mang ý nghĩa chiến thuật.

Thay vào đó:

```text
AKG
 ↓
planning projection
 ↓
AttackState / Transition graph
 ↓
Dijkstra / A*
```

Ví dụ projection:

```text
Session(web01, svc_web)
        │
        │ credential_reuse
        ▼
Session(fs01, svc_backup)
        │
        │ privilege_escalation
        ▼
Session(fs01, root)
        │
        │ lateral_movement
        ▼
Session(dc01, administrator)
```

Mỗi transition có:

```text
cost
confidence
opsec_risk
required_capability
required_skill
attempt_status
```

Đây mới là graph phù hợp cho planner.

---

# 20. `tried_edges` không nên là state riêng mãi mãi

Repo hiện có `middleware/tried_edges.py`. `repo-structure.txt`

Nhưng nếu mọi attempt đều là `Action`, thì failed attempt đã có:

```text
Action.status = failed
Action.target = fs01
Action.capability = lateral_movement
```

Graph reasoner có thể derive:

```text
transition này đã thử và thất bại
```

Như vậy tránh duplicate state:

```text
tried_edges store
+
Action history
```

chỉ cần một source of truth.

---

# 21. Có hai graph khác nhau trong Raptix

Đây là một distinction rất quan trọng.

Repo hiện tại có cả:

```text
middleware/kg_internal/
```

và:

```text
skills/engine/server/neo4j_backend.py
```

`repo-structure.txt`

Không được hiểu chúng là cùng một graph.

## Attack Knowledge Graph

```text
AKG
```

lưu state của engagement hiện tại:

```text
host
service
identity
credential
session
action
evidence
finding
objective
```

Nó thay đổi liên tục trong một mission.

---

## Skill Knowledge Graph

```text
Skill Graph
```

lưu knowledge tương đối ổn định:

```text
skill
technique
MITRE mapping
capability
requirements
produces
domain
UKC phase compatibility
```

Ví dụ:

```text
credential-reuse skill
→ capability lateral_movement
→ phase network_propagation
→ requires credential
```

---

# 22. Hai graph có thể cùng dùng Neo4j nhưng phải logical separation

Có thể tiết kiệm tài nguyên bằng cùng một Neo4j instance.

Nhưng API phải khác:

```text
AttackGraphRepository

SkillGraphRepository
```

Không để planner tùy ý raw join hai graph.

Runtime service mới chịu trách nhiệm:

```text
Attack state
+
required capability
+
skill graph
=
eligible skill
```

---

# 23. Skill không nằm trong AKG

Skill không phải state của engagement.

Không tạo:

```text
Session ─→ Skill
Asset ─→ Skill
```

trong canonical AKG nếu không có nhu cầu thật.

Skill selector hoạt động kiểu:

```text
Phase
+
AttackGraph state
+
CandidateTransition
+
Skill metadata
=
eligible skill
```

Graph attack và graph skill có nhiệm vụ khác nhau.

---

# 24. UKC metadata nằm trong skill, không phải duplicate skill tree

Skill vẫn tổ chức theo domain:

```text
web/
ad/
post-exploit/
cloud/
...
```

nhưng có metadata:

```yaml
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

Như vậy một skill có thể phục vụ nhiều phase.

---

# 25. Graph subsystem không được nằm dưới middleware

Repo hiện tại đang có:

```text
middleware/
└── kg_internal/
    ├── migrations/
    ├── ingest.py
    ├── state.py
    ├── store.py
    ├── summary.py
    └── tools.py
```

`repo-structure.txt`

Chúng ta đã thống nhất đây là architecture smell.

Target:

```text
knowledge/
└── graph/
    ├── model.py
    ├── repository.py
    ├── ingest.py
    ├── queries/
    ├── reasoning/
    └── neo4j/
```

Middleware chỉ còn:

```text
middleware/graph_context.py
middleware/graph_ingest.py
```

tức là thin integration layer.

---

# 26. Neo4j là implementation, không phải abstraction

Raptix dùng Neo4j.

Nhưng business logic không nên phụ thuộc:

```text
neo4j.Driver
Cypher
APOC
```

trực tiếp.

Abstraction là:

```text
AttackGraphRepository
GraphQueryService
```

Implementation:

```text
Neo4jAttackGraphRepository
```

Nhờ vậy:

```text
Planner
PhaseEngine
Finding service
Reporting
```

không cần biết Neo4j.

---

# 27. Core chỉ giữ graph contracts

Trong `raptix-core` có thể có:

```text
types/graph.py
protocols/graph.py
```

nhưng không có:

```text
Neo4j
Cypher
migration runner
APOC
```

Repo hiện tại đã có tư tưởng này vì `raptix-core` được thiết kế là contracts/protocols/types với zero framework dependencies. `repo-structure.txt`

Graph architecture mới nên giữ nguyên invariant đó.

---

# 28. Graph revision / event history

Ta cũng đã bàn tới việc graph cần auditability.

Một cách pragmatic:

```text
canonical current graph
+
append-only event log
```

Mỗi mutation batch tăng:

```text
graph_revision
```

Ví dụ:

```text
1201
1202
1203
```

Phase transition lưu:

```text
from_phase
to_phase
reason
graph_revision=1203
```

Khi debug có thể trả lời:

> Phase chuyển vì graph state nào?

Không nhất thiết implement full event-sourced graph ngay từ đầu.

---

# 29. Artifact store phải tách khỏi graph backend

Không hard-code:

```python
open("workspace/findings/F-001.md")
```

Mà nên có abstraction:

```text
ArtifactStore
```

Implementation ban đầu:

```text
FilesystemArtifactStore
```

Sau này có thể đổi:

```text
S3ArtifactStore
DatabaseArtifactStore
```

AKG chỉ giữ:

```text
artifact_ref
```

Graph không quan tâm artifact vật lý nằm ở đâu.

---

# 30. Mối quan hệ tổng thể cuối cùng

Có thể hình dung toàn bộ Raptix như sau:

```text
                   Mission / Objective
                           │
                           ▼
                    Orchestration
                    / Phase Engine
                           │
                           ▼
                    Graph Query Layer
                           │
                           ▼
                    Attack Knowledge
                         Graph
                           │
                ┌──────────┼──────────┐
                │          │          │
              State    Provenance   History
                │
                ▼
                  Graph Reasoner
                       │
                       ▼
              CandidateTransition[]
                       │
                       ▼
                    Planner
                       │
                       ▼
              Capability / Intent
                       │
                       ▼
                 Skill Selector
                   │       │
                   │       └──── Skill Graph
                   ▼
                    Agent
                       │
                       ▼
                    Tool
                       │
                       ▼
                    Action
                       │
               ┌───────┴────────┐
               ▼                ▼
           Evidence          Observation
               │                │
               ▼                ▼
         Artifact Store        AKG
```

Đây là bức tranh cuối cùng chúng ta đang hướng tới.

---

# 31. Những điều **không nên làm**

Chốt lại, có vài anti-pattern chúng ta đã loại bỏ:

```text
Không nhét toàn bộ Markdown/raw output vào Neo4j.

Không để LLM tự ghi fact chưa xác minh.

Không coi Foothold là một node riêng nếu Session đã biểu diễn được.

Không tạo Privilege node nếu chỉ cần privilege level.

Không tạo edge mơ hồ chỉ để graph nhìn nhiều quan hệ.

Không persist mọi inference như fact.

Không chạy shortest-path trực tiếp trên toàn heterogeneous AKG.

Không để planner raw Cypher.

Không để graph implementation nằm dưới middleware.

Không merge Attack Graph và Skill Graph.

Không biến UKC phase thành graph node.

Không tổ chức toàn bộ agents/tools/skills theo 3 UKC phase.
```

---

# 32. Chốt ngắn nhất

Nếu cần giải thích AKG của Raptix trong vài câu, mình sẽ viết:

> **Raptix sử dụng Attack Knowledge Graph làm nguồn trạng thái ngữ nghĩa trung tâm cho từng engagement. Graph lưu các thực thể có ý nghĩa cho reasoning như asset, service, identity, credential, session, vulnerability, action, evidence, finding và objective cùng quan hệ/provenance giữa chúng. Nội dung lớn như Markdown, log, screenshot và raw evidence được lưu ngoài graph dưới dạng artifact và liên kết bằng reference. AKG chỉ lưu canonical facts; inference và attack path được tạo bởi reasoning layer rồi xác minh thông qua execution trước khi trở thành fact mới. UKC phase được quản lý bởi orchestration layer dựa trên trạng thái AKG, trong khi Skill Knowledge Graph là một graph riêng dùng để mô hình hóa capability và skill metadata.**

Đó là kiến trúc graph mình nghĩ đã đủ rõ để từ đây chuyển sang bước tiếp theo: **chốt schema AKG cụ thể (node properties + edge properties + constraints + artifact model) rồi mới viết migration Neo4j**.

## Prompt:
05/10/2026, 13:45:24

so sánh sự khác biệt giữa proposal AKG của Raptix với cách dùng graph trong decepticon cho tôi   làm sao để khẳng định được proposal trên thật sự tốt hơn, hoặc tối thiểu là phải không kém hơn? dựa vào lập luận khách quan cùng các bằng chứng thực tế để trả lời cho tôi

## Response:
05/10/2026, 13:45:43 · gpt-5-6-thinking

> **Comparing graph designs**
>
> I’m framing the choice around graph purpose, schema complexity, provenance, and planning performance. I’m also separating canonical facts from derived paths, then checking which external standards and repository evidence best support that distinction.
>
> **Compared graph designs**
>
> 
>
> **Refining path planning**
>
> I’m distinguishing severity from exploitability, since treating severity as path difficulty can mis-rank routes. I’m comparing direct heterogeneous-graph search with a projected state-transition model and emphasizing auditability through explicit evidence-to-action links.
>
> **Correcting the comparison**
>
> I’m revisiting the distinction because the current implementation already includes typed entities, provenance, observations, hypotheses, and attack paths. I’ll compare the proposal against that actual baseline, not just its documentation.
>
> **Refined path planning and corrected the comparison**
>
> 
>
> **Searched 4 websites**
>
> 
>
> Worked for 3m 23s

Có một điểm cần cập nhật so với cách chúng ta mô tả Decepticon trước đó: **Decepticon hiện tại dùng graph tốt hơn đáng kể so với một “KG tĩnh để shortest-path”**. Nếu lấy `main` hiện nay làm baseline, Raptix **không thể** claim tốt hơn chỉ vì có Neo4j, provenance, Session, Candidate/Hypothesis hay weighted path - Decepticon đã có phần lớn những thứ đó.

Điều này thực ra có lợi cho đề tài của bạn: thay vì dựng một strawman yếu, ta có thể chỉ ra **Raptix thay đổi đúng những điểm nào, vì sao về mặt kỹ thuật chúng đáng giá, và thiết kế thí nghiệm để chứng minh non-regression/superiority**.

## So sánh trực tiếp AKG

| Khía cạnh | Decepticon hiện tại | Proposal Raptix AKG | Đánh giá |
|---|---|---|---|
| Vai trò graph | Persistent operational attack graph, dùng cho cross-domain state và attack-path planning | Canonical semantic state của engagement + provenance backbone + input cho reasoning | Khác emphasis, chưa tự động tốt hơn |
| Schema | Rất rộng: Host, Network, Domain, Service, URL, CloudResource, Container, User, Group, Credential, Session, Vulnerability, CVE, Technique, Entrypoint, CrownJewel, AttackPath, Finding, Candidate, Hypothesis, AD-specific... | Base schema nhỏ hơn: Engagement, Objective, Asset, Service, Identity, Credential, Session, Vulnerability, Finding, **Action, Evidence** + extension/plugin types | Raptix sạch hơn nếu extensible; có nguy cơ **mất fidelity** nếu collapse quá mạnh |
| Foothold | Có `Session` | Foothold = verified `Session` | Gần như tương đương |
| Fact vs chưa xác minh | Có `Candidate`, `Hypothesis`; detection low-confidence có thể bị đánh dấu không đủ để drive exploit | Tách rõ Fact → Inference → Attempt → Observation → Fact; inference không persist mặc định | Raptix formalize mạnh hơn, nhưng ý tưởng không hoàn toàn mới |
| Provenance | Node/edge tự động có `created_by`, `source_episode_id`, `firstseen`, `lastupdated`; write atomic | `Action` và `Evidence` là first-class entity, provenance chain `Finding ← Evidence ← Action` | Đây là một khác biệt thực sự có tiềm năng |
| Artifacts | Finding đã được lưu Markdown; recon/exploit artifacts nằm workspace | Graph metadata + ArtifactStore; Markdown/raw evidence bên ngoài graph | Decepticon **đã dùng hybrid storage**, Raptix không thể claim đây là novelty |
| Path planning | Dijkstra/shortestPath trực tiếp trên attack relations; có thể materialize `AttackPath` | AKG → planning projection → `AttackState/Transition` → Dijkstra/A*/scorer | Đây là khác biệt kiến trúc quan trọng |
| Path state | Các edge như `CAN_ACCESS`, `PIVOTS_TO`, `ESCALATES_TO`, `LEADS_TO` tồn tại trong graph | Hạn chế derived relation trong canonical graph; generate `CandidateTransition` | Raptix có semantics sạch hơn nếu implement đúng |
| Failed attempts | Có operational history bên ngoài/graph state, current code còn nhiều runtime state | `Action(status=failed)` trở thành nguồn để derive attempted transitions | Có tiềm năng giảm duplicate state |
| Phase | Decepticon có OPPLAN phases và agent dispatch theo phase | UKC 3-phase là explicit state machine dựa trên AKG | Raptix formal hơn nhưng phải chứng minh không constrain planner |
| Skill graph | Skillogy dùng typed Neo4j graph; có phase, prerequisite, technique, tool, asset type và runtime bridges | AttackGraph và SkillGraph là **hai abstraction riêng**, service layer kết hợp | Khác biệt chủ yếu ở boundary/API, không phải ý tưởng dùng graph |
| DB isolation | Engagement-scoped Neo4j, transactions, provenance; đã harden mạnh | Repository + query service, planner không raw-Cypher | Raptix có cơ sở để giảm coupling/risk |
| Maturity | Đã chạy production-like code + public benchmark | Proposal / đang migrate | **Decepticon hiện có bằng chứng thực nghiệm mạnh hơn** |

Decepticon hiện mô tả graph là Neo4j-native, append-mostly, deterministic IDs, schema-validated, với Session, Candidate/Hypothesis, AttackPath và nhiều lớp domain-specific; authoritative store là Neo4j. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/packages/decepticon-core/decepticon_core/types/kg.py)) Store hiện tại còn auto-inject provenance cho mọi node/edge và ghi observation batch trong một transaction. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/packages/decepticon/decepticon/middleware/kg_internal/store.py))

Vì vậy, **không nên viết trong báo cáo rằng “Decepticon chỉ dùng graph tĩnh cho path planning”**. Câu đó không còn đúng với code hiện tại.

---

## Khác biệt mạnh nhất số 1 của Raptix: `Action` và `Evidence` là first-class entities

Đây là chỗ mình thấy proposal của bạn thực sự có lý do kỹ thuật rõ.

Decepticon có provenance như:

```text
Host
 ├── created_by = recon
 └── source_episode_id = tool-call-123
```

Cách đó tốt và khá nhẹ. Nhưng trong canonical `NodeKind` hiện tại không có generic `Action` hay `Evidence`; generic provenance chủ yếu được gắn vào node/edge bằng metadata. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/packages/decepticon-core/decepticon_core/types/kg.py))

Raptix muốn biểu diễn:

```text
              ┌───────────────┐
              │    Action     │
              │ A-001         │
              │ tool=nmap     │
              │ status=success│
              └───────┬───────┘
                      │ PRODUCED
                      ▼
               ┌─────────────┐
               │  Evidence   │
               │   E-001     │
               └──────┬──────┘
                      │ SUPPORTS
                      ▼
               ┌─────────────┐
               │   Finding   │
               │   F-001     │
               └─────────────┘
```

Điều này gần với provenance model chuẩn hơn: W3C PROV phân biệt rõ **Activity** - một hoạt động xảy ra và sử dụng/sinh ra dữ liệu - với **Entity**, là artifact/data được tạo hoặc sử dụng. ([W3C](https://www.w3.org/TR/2012/CR-prov-o-20121211/?utm_source=chatgpt.com))

Raptix tương ứng khá tự nhiên:

```text
W3C PROV       Raptix
-------------------------------
Activity   →   Action
Entity     →   Evidence
Agent      →   Agent/operator
```

Đây **không chứng minh performance tốt hơn**, nhưng nó cho bạn một lập luận khách quan rằng Raptix có provenance semantics mạnh hơn cho audit.

Ví dụ query được:

```text
Finding F-023 được xác minh từ evidence nào?
Evidence đó do command/tool nào tạo?
Agent nào thực hiện?
Đang ở UKC phase nào?
Credential nào được dùng?
Target nào bị tác động?
Execution có thành công thật không?
```

Với `source_episode_id`, Decepticon có thể reconstruct được một phần; với `Action/Evidence`, các quan hệ này trở thành first-class queryable semantics.

### Nhưng có trade-off

`Action` cho **mọi command** có thể làm graph phình cực nhanh.

Do đó Raptix không nên đưa mọi stdout vào graph. Nên là:

```text
Action node
    metadata only

Evidence node
    metadata + artifact_ref

Raw output
    ArtifactStore
```

và có retention/promotion policy.

Nếu không làm vậy, proposal có thể tệ hơn Decepticon về storage và query performance.

---

# Khác biệt mạnh thứ 2: canonical facts tách khỏi planning inference

Decepticon hiện có cả các edge kiểu:

```text
CAN_ACCESS
LEADS_TO
PIVOTS_TO
ESCALATES_TO
ENABLES
```

và chain planner chạy Dijkstra trực tiếp trên các attack relationship đó. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/packages/decepticon-core/decepticon_core/types/kg.py))

Ví dụ runtime thực tế:

```text
Entrypoint
    │
   ...
    │ LEADS_TO
    ▼
Host
    │ PIVOTS_TO
    ▼
Host
    │ ESCALATES_TO
    ▼
CrownJewel
```

sau đó:

```python
apoc.algo.dijkstra(...)
```

Decepticon còn có thể promote kết quả thành một `AttackPath` node có `STARTS_AT`, `REACHES` và các `STEP`. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/packages/decepticon/decepticon/tools/research/chain.py))

Raptix proposal khác:

```text
                Canonical AKG

Asset ─ Service ─ Credential ─ Identity
          │
       Session
          │
       Actions
          │
       Evidence
```

rồi:

```text
Canonical AKG
      │
      ▼
 Graph Reasoner
      │
      ▼
Planning Projection

Session(web01,user)
      │ credential_reuse
      ▼
Session(fs01,svc)
      │ privesc
      ▼
Session(fs01,root)
      │ lateral_move
      ▼
Session(dc01,admin)
```

Tức là **“world state” và “possible moves” không phải cùng một graph semantics**.

Đây là một improvement có cơ sở rất tốt về mặt modelling.

Một canonical fact như:

```text
Credential C authenticates Identity I
```

khác về bản chất với:

```text
Credential C MAY enable lateral movement to Host X
```

Cái đầu là observation/state.

Cái sau là một planning hypothesis.

Nếu chúng nằm cùng graph và đều được traversable như nhau, rất dễ biến:

```text
possible
```

thành:

```text
known true
```

trong reasoning downstream.

Raptix muốn buộc flow:

```text
FACT
 ↓
INFERENCE
 ↓
CANDIDATE TRANSITION
 ↓
EXECUTION
 ↓
OBSERVATION
 ↓
VERIFIED FACT
```

Đây là khác biệt mà mình nghĩ đáng bảo vệ.

---

# Tuy nhiên Decepticon cũng đã nhận ra vấn đề này

Không nên claim:

> “Decepticon không phân biệt fact và inference.”

Điều đó cũng không đúng.

Decepticon có `Candidate` và `Hypothesis`; ADR Technology còn quy định low-confidence detection chỉ là corroborating signal và **không được tự nó drive exploit chain**. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docs/adr/0007-ai-surface-technology-node.md?utm_source=chatgpt.com))

Skillogy thậm chí lưu `confidence`, `provenance`, `justification`, model và thời điểm đối với các edge do LLM inference. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/skillogy.md?utm_source=chatgpt.com))

Vì vậy claim chính xác hơn của Raptix phải là:

> **Raptix nâng separation giữa observed state và planning inference thành một architectural invariant xuyên suốt graph, thay vì xử lý theo từng node/edge category.**

Câu này defend được hơn.

---

# Khác biệt mạnh thứ 3: planning projection thay vì shortest path trên heterogeneous KG

Decepticon graph chứa rất nhiều loại entity:

```text
Host
Network
URL
Service
User
Group
Credential
CVE
Weakness
Technique
Finding
Candidate
Hypothesis
...
```

([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/packages/decepticon-core/decepticon_core/types/kg.py))

Chain planner lại traversal một tập relationship mang `cost`. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/packages/decepticon/decepticon/tools/research/chain.py))

Cách đó đơn giản và hiệu quả, nhưng có một vấn đề: **Neo4j path không tự nhiên đồng nghĩa với attacker action sequence**.

Ví dụ:

```text
Credential
 -> User
 -> Group
 -> Service
 -> Vulnerability
 -> Host
```

có thể là một path hợp lệ về topology, nhưng chưa chắc là một sequence hành động executable.

Raptix giải quyết bằng intermediate representation:

```text
AKG
 ↓
Attack-state projection
 ↓
Transitions
 ↓
Planner
```

Một transition bắt buộc có:

```text
preconditions
capability
target
expected effect
cost
confidence
risk
attempt status
```

Do đó planner đi qua:

```text
actionable transitions
```

chứ không đi qua:

```text
arbitrary graph edges
```

### Đây là nơi bạn có thể chứng minh Raptix tốt hơn khá rõ

Không cần MHBench.

Bạn có thể tạo 50-100 **known graph fixtures** với expected attack paths và đo:

```text
Precision(candidate transitions)
Recall(valid transitions)
Invalid path rate
Optimal executable path rate
```

Decepticon planner và Raptix projection nhận **cùng một underlying state**.

Nếu Decepticon trả:

```text
10 paths
4 thực sự executable
```

còn Raptix:

```text
7 paths
7 executable
```

thì bạn có bằng chứng trực tiếp cho improvement của graph reasoning.

Không phụ thuộc LLM.

---

# Một điểm Raptix có cơ sở để cải thiện thật: query boundary

Có một bằng chứng thực tế rất đáng giá ngay trong history của Decepticon.

Decepticon v1.1.40 phải sửa một bug nơi các legacy attack-graph helpers/raw Cypher không enforce engagement scope đầy đủ; `plan_attack_chains` có thể đi qua `query_custom`, tạo khả năng cross-engagement read/write trong shared graph. Sau đó `execute_read`/`execute_write` được harden để bắt buộc `$engagement`. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/CHANGELOG.md?utm_source=chatgpt.com))

Đây là bằng chứng thực tế rằng:

```text
Planner/business logic
        ↓
     raw Cypher
        ↓
      Neo4j
```

tạo coupling và safety risk.

Proposal Raptix:

```text
Planner
   ↓
GraphQueryService
   ↓
AttackGraphRepository
   ↓
Neo4j implementation
```

không chỉ là “clean architecture cho đẹp”.

Nó trực tiếp loại bỏ một **bug class đã từng xuất hiện trong baseline**.

Đây là một trong những lập luận mạnh nhất bạn có thể đưa vào report.

Nhưng nhớ: Decepticon **đã fix bug này**, nên claim phải là:

> “Raptix đưa engagement isolation và graph access vào architectural boundary nhằm giảm khả năng tái xuất hiện lớp lỗi từng được ghi nhận ở baseline.”

Chứ không phải:

> “Decepticon hiện không isolate engagement.”

---

# Điểm scoring của Decepticon cũng có chỗ để cải thiện

Design document của Decepticon mô tả edge-cost bằng exploitation difficulty và đưa ra một công thức trong đó severity càng cao thì cost càng thấp. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/design/attack-graph-schema.md))

Về mặt security metric, **severity không đồng nghĩa exploitation likelihood**. FIRST mô tả EPSS là xác suất exploitation observed trong 30 ngày và nhấn mạnh nó không phải impact/risk score; ngược lại severity/impact và exploitation probability là các khái niệm khác nhau. ([FIRST](https://www.first.org/epss/faq.html?utm_source=chatgpt.com))

Do đó Raptix không nên dùng một scalar kiểu:

```text
critical CVE
→ easy exploit
→ low cost
```

mặc định.

Proposal tốt hơn nên giữ riêng:

```text
execution_cost
confidence
exploitability
opsec_risk
expected_progress
historical_failure
```

sau đó scorer mới scalarize:

```text
transition score =
   expected_progress
 - execution_cost
 - opsec_risk
 - uncertainty
 - repeated_failure_penalty
```

Nếu làm vậy, đây là một improvement kỹ thuật hợp lý.

Nhưng vẫn cần calibration qua experiment.

---

# Chỗ Raptix hiện tại **có nguy cơ kém Decepticon**

Đây là phần mình nghĩ rất quan trọng.

Proposal trước đó của chúng ta giảm schema xuống:

```text
Asset
Service
Identity
Credential
Session
Vulnerability
...
```

trong khi Decepticon hiện có:

```text
Network
Domain
Host
URL
CloudResource
Container
User
Group
Secret
CVE
Misconfiguration
Weakness
Repository
CodeLocation
Technique
...
```

cùng hàng loạt AD-specific labels. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/packages/decepticon-core/decepticon_core/types/kg.py))

Nếu Raptix thực sự **collapse** hết:

```text
Host
Network
URL
CloudResource
Container
```

thành một generic:

```text
Asset
```

thì Raptix có thể **kém hơn**, không phải tốt hơn.

Mình sẽ chỉnh proposal tại đây:

```text
            Asset
              │
      ┌───────┼────────┐
      ▼       ▼        ▼
    Host    Network   Application
                       │
                       ▼
                      URL

Identity
   ├── User
   ├── Group
   └── ServiceAccount
```

Không nhất thiết các subtype đều thành Python class cứng, nhưng graph phải giữ **semantic subtype**.

Tức là:

> **Canonical schema nhỏ không đồng nghĩa schema nghèo.**

Core ontology nhỏ.

Domain ontology extensible.

Đây là cách để đảm bảo không regress so với Decepticon.

---

# Skill Graph cũng không phải novelty của Raptix

Decepticon đã có Skillogy: typed graph của Skill/Phase/Technique/Tool/AssetType, có prerequisite và runtime bridges tới engagement state. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/skillogy.md?utm_source=chatgpt.com))

Do đó không nên claim:

> “Raptix mới có một graph riêng để quản lý skills.”

Claim hợp lý hơn:

> **Raptix muốn enforce logical/API separation giữa Attack Knowledge Graph và Skill Knowledge Graph, dù cả hai có thể dùng chung Neo4j infrastructure.**

Ví dụ:

```text
AttackGraphRepository
SkillGraphRepository
```

Planner không raw join chúng.

Một orchestration service mới kết hợp:

```text
Attack state
+
phase
+
candidate capability
+
skill graph
=
eligible execution
```

Đây là boundary improvement, không phải novel graph concept.

---

# Vậy hiện giờ Raptix có thực sự “tốt hơn” không?

**Chưa thể nói.**

Hiện tại kết luận khách quan nhất là:

> **Raptix AKG proposal có một số architectural hypotheses hợp lý hơn Decepticon ở semantic provenance, separation of fact/inference, action-oriented planning projection và graph access boundaries; nhưng chưa có bằng chứng thực nghiệm cho thấy nó cải thiện effectiveness hoặc efficiency.**

Ngược lại, Decepticon có advantage cực lớn:

**nó đã chạy.**

Repo công bố 102/104 trên XBOW. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/benchmark/results/README.md?utm_source=chatgpt.com))

Con số đó không chứng minh graph của Decepticon tốt - XBOW là 104 web-app CTF và Decepticon còn được cung cấp description + vulnerability tags, nên chính tài liệu Decepticon cũng cảnh báo các kết quả giữa hệ thống có mức hint khác nhau. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docs/benchmark-comparison.md?utm_source=chatgpt.com))

Nhưng nó chứng minh:

> baseline hiện tại có end-to-end capability rất mạnh và Raptix không được phép phá nó.

---

# Làm sao chứng minh **Raptix ≥ Decepticon**?

Đây mới là phần quan trọng nhất cho đề tài của bạn.

Bạn không cần MHBench để làm điều đó.

Hãy coi đây là **paired architecture experiment**:

| Evaluation | Decepticon | Raptix | Điều cần chứng minh |
|---|---:|---:|---|
| Same observations → graph correctness | baseline | new AKG | Raptix ≥ |
| Valid attack transition recall | baseline | projection | Raptix ≥ |
| Invalid transition precision | baseline | projection | Raptix > |
| Objective completion | baseline | Raptix | Raptix non-inferior |
| Tool calls to objective | baseline | Raptix | không regress đáng kể |
| Failed-branch repetition | baseline | Raptix | Raptix < |
| Recovery after failed action | baseline | Raptix | Raptix ≥ |
| Verified finding provenance | baseline | Action/Evidence model | Raptix > |
| Cross-engagement isolation | baseline | repository boundary | cả hai 100% |
| Duplicate/stale state | baseline | deterministic canonical state | Raptix ≤ |
| Planner tokens/context | baseline | structured PhaseContext | Raptix ≤ |
| Graph query latency | baseline | Raptix | không regress nghiêm trọng |

Quan trọng nhất là **giữ mọi biến còn lại giống nhau**:

```text
same model
same temperature
same target
same prompt
same tools
same skill corpus
same sandbox
same budget
same timeout
```

chỉ thay:

```text
Decepticon graph/planner layer
vs
Raptix AKG/reasoner layer
```

Nếu bạn đổi LLM + prompt + graph + skills cùng lúc thì không thể nói improvement đến từ AKG.

---

## Ba tầng bằng chứng bạn cần

**Tầng 1 - deterministic graph tests.** Không cần LLM, không cần lab lớn. Tạo graph fixtures có ground truth, ví dụ 30-100 case về credential reuse, privilege path, unreachable subnet, false credential, failed pivot, alternative path. Đo precision/recall của generated attack transitions và expected path.

**Tầng 2 - controlled multi-host lab.** Chỉ cần vài lab nhỏ mà bạn dựng/chạy được. Mỗi scenario có một ground-truth chain như `Host A → credential → Host B → privesc → Host C`. Chạy paired Decepticon/Raptix nhiều lần với cùng model và budget.

**Tầng 3 - end-to-end non-regression.** Chạy những benchmark/lab bạn thực sự truy cập được để chứng minh refactor graph không làm giảm khả năng exploitation chung.

Nếu chỉ hoàn thành tầng 1 và 2, bạn vẫn đã có bằng chứng khá tốt cho **graph contribution**, thậm chí còn sạch hơn chạy một benchmark lớn mà không isolate architecture.

---

# Tiêu chí claim nên đặt thế nào?

Đừng đặt mục tiêu:

> “Raptix phải thắng Decepticon mọi metric.”

Mục tiêu khoa học hợp lý hơn là **non-inferiority + targeted improvement**.

Ví dụ bạn tự preregister trước:

```text
Effectiveness:
Raptix objective success không thấp hơn baseline quá 5 percentage points.

Efficiency:
median tool calls / wall time không tăng quá 10%.

Reliability:
failed-branch repetition không cao hơn baseline.

Graph correctness:
candidate transition precision và recall không thấp hơn baseline.

Auditability:
100% verified findings phải truy được
Finding → Evidence → Action.

Safety:
0 cross-engagement state leakage.
```

Các ngưỡng 5%/10% ở đây là **project acceptance criteria đề xuất**, không phải industry standard.

Nếu Raptix đạt:

```text
same success
same hoặc lower cost
better transition precision
better provenance
better recovery
```

thì bạn có cơ sở rất mạnh để viết:

> **Raptix maintains the effectiveness of the Decepticon baseline while improving graph-state semantics, provenance and planning reliability.**

Đây mạnh hơn nhiều so với một câu mơ hồ:

> “Our architecture is better.”

---

# Và cần một ablation

Nếu muốn chứng minh **chính AKG mới** tạo ra improvement, ít nhất cần:

```text
A - Decepticon baseline

B - Raptix + new canonical AKG
    nhưng không planning projection

C - Raptix + AKG
    + planning projection
    + Action/Evidence provenance
```

Nếu:

```text
A ≈ B
C > B
```

ở path precision/recovery,

thì bạn có bằng chứng rằng:

```text
planning projection
```

có giá trị.

Nếu:

```text
A ≈ B ≈ C
```

thì ít nhất bạn chứng minh architecture refactor **không làm kém đi**, trong khi code boundaries/provenance tốt hơn.

Đó vẫn là một kết quả hợp lệ.

---

## Kết luận mình sẽ dùng cho định hướng Raptix

Mình sẽ **không** positioning Raptix AKG là:

> “Graph tốt hơn Decepticon vì Decepticon chỉ dùng shortest path.”

Mà positioning là:

> **Decepticon đã có một attack graph mạnh và mature. Raptix kế thừa nền tảng đó nhưng tái cấu trúc graph thành một canonical engagement state với explicit provenance, tách observed facts khỏi planning hypotheses, đưa attack-path search qua action-oriented planning projection, và giới hạn graph access thông qua typed repository/query interfaces. Mục tiêu không phải thay Neo4j hay tăng số node/edge, mà là làm cho state, reasoning và execution có semantics tách biệt và có thể kiểm chứng.**

Và câu quan trọng nhất cho báo cáo:

> **Những thay đổi trên hiện là architectural hypotheses, không phải kết quả thực nghiệm. Tính ưu việt chỉ được khẳng định khi Raptix đạt non-inferiority về task completion so với Decepticon trong cùng điều kiện, đồng thời cải thiện ít nhất một trong các tiêu chí graph correctness, provenance, recovery hoặc planning efficiency.**

Theo mình, đây là cách defend proposal mạnh nhất trước giảng viên hoặc reviewer, bởi vì nó vừa **không hạ thấp baseline**, vừa chỉ ra chính xác Raptix đang đóng góp gì và **bằng chứng nào cần có để biến “thiết kế hay” thành “thiết kế tốt hơn”**.

---

**Sources:**

- [Decepticon/packages/decepticon-core/decepticon_core/types/kg.py at main · BitterSecurity/Decepticon · GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/packages/decepticon-core/decepticon_core/types/kg.py)
- [PROV-O: The PROV Ontology](https://www.w3.org/TR/2012/CR-prov-o-20121211/?utm_source=chatgpt.com)
- [EPSS Frequently Asked Questions](https://www.first.org/epss/faq.html?utm_source=chatgpt.com)

## Prompt:
06/10/2026, 10:04:09

tổng hợp lại lý do vì sao phải cải tiến graph của decepticon gốc

## Response:
06/10/2026, 10:04:31 · gpt-5-6-thinking

> **Framing architecture improvements**
>
> I’m framing Raptix’s changes as improvements over Decepticon’s baseline: separating operational facts from planning, making provenance first-class, reducing storage coupling, preventing state divergence, and distinguishing graph paths from executable plans.
>
> **Framed architecture improvements**
>
> 
>
> Worked for 22s

Nếu gọi **graph của Decepticon gốc là baseline mà Raptix kế thừa**, thì lý do phải cải tiến **không phải vì Decepticon dùng graph kém**. Ngược lại, Decepticon đã có Neo4j làm persistent attack-chain memory, schema khá giàu và shortest-path planning. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docker-compose.yml?utm_source=chatgpt.com)) Vấn đề là kiến trúc đó chưa tối ưu cho mục tiêu mới của Raptix: **multi-host autonomous red team dài hơi, reasoning có thể kiểm chứng, UKC 3-phase và state đủ sạch để sau này đưa planner/HRL vào**.

| Vấn đề cần cải tiến | Decepticon baseline | Vì sao chưa đủ cho Raptix | Hướng Raptix |
|---|---|---|---|
| **1. Fact và planning inference còn nằm quá gần nhau** | Attack graph có các edge như `ENABLES`, `LEADS_TO`, `PIVOTS_TO`, `ESCALATES_TO`, được dùng trực tiếp để tìm attack path. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/design/attack-graph-schema.md?utm_source=chatgpt.com)) | “Có khả năng pivot” và “đã pivot thành công” là hai loại tri thức khác nhau. Nếu cùng tham gia traversal, planner dễ coi khả năng thành sự thật. | Canonical graph chỉ giữ verified/observed state; inference sinh `CandidateTransition`, chỉ promote thành fact sau execution. |
| **2. Graph path chưa đồng nghĩa executable attack plan** | Decepticon chạy Dijkstra trên tập relationship của heterogeneous KG. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/design/attack-graph-schema.md?utm_source=chatgpt.com)) | Một path hợp lệ về graph topology chưa chắc tương ứng chuỗi hành động có precondition/tool/capability thực thi được. | AKG → planning projection → `AttackState → Transition → AttackState`, rồi mới shortest-path/ranking. |
| **3. Provenance chưa là first-class execution semantics** | Decepticon đã có workspace artifacts và findings Markdown; graph cũng có provenance metadata. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/engagement-workflow.md?utm_source=chatgpt.com)) | Với autonomous red team, cần trả lời trực tiếp “finding này do action nào, evidence nào, tool nào chứng minh?”. Metadata đơn thuần khó reason/audit hơn. | `Action` và `Evidence` thành first-class node; `Finding ← Evidence ← Action` là canonical provenance chain. |
| **4. Business logic từng phụ thuộc raw graph query quá mạnh** | Changelog Decepticon ghi nhận `plan_attack_chains` dùng raw Cypher qua `query_custom`; lỗi scope từng cho phép cross-engagement read/write trước khi được harden. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/CHANGELOG.md)) | Đây là bằng chứng thực tế rằng việc để planner/helper gần Neo4j/Cypher tạo coupling và safety bug class. | Planner chỉ dùng `GraphQueryService`/`AttackGraphRepository`; Neo4j là implementation detail. |
| **5. Schema domain ngày càng phình** | Decepticon thêm typed node như `Technology`; chính ADR thừa nhận mỗi node kind mới làm public schema khó bảo trì hơn. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docs/adr/0007-ai-surface-technology-node.md?utm_source=chatgpt.com)) | Khi thêm AD/cloud/AI/mobile/... core ontology có nguy cơ tăng vô hạn và planner phụ thuộc schema domain. | Core ontology nhỏ + semantic subtype/domain extension/plugin. |
| **6. Phase orchestration chưa lấy graph state làm invariant trung tâm** | Decepticon có OPPLAN phases như recon, initial-access, post-exploit, C2, exfiltration. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/engagement-workflow.md?utm_source=chatgpt.com)) | Raptix muốn 3 macro-phase UKC và transition phải dựa trên verified operational state, không chỉ trên plan/prompt. | `PhaseEngine` riêng: `INITIAL_FOOTHOLD → NETWORK_PROPAGATION → ACTION_ON_OBJECTIVES`, graph cung cấp `PhaseContext`. |
| **7. Khó tạo nền sạch cho planner tối ưu/HRL** | Graph hiện đồng thời là state representation và path-planning substrate. | RL/HRL cần state/action/reward tương đối rõ; heterogeneous raw graph không phải action space tốt. | Canonical state → explicit candidate transitions → scorer/policy. Đây là interface tự nhiên hơn cho HRL sau này. |

### 1. Lý do cốt lõi nhất: tách **“thế giới hiện tại”** khỏi **“những gì có thể thử tiếp”**

Đây là thay đổi đáng giá nhất.

Decepticon có thể có:

```text
Host A
  ──PIVOTS_TO──> Host B
  ──LEADS_TO───> Host C
```

và Dijkstra dùng các edge đó để tìm path. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/design/attack-graph-schema.md?utm_source=chatgpt.com))

Raptix muốn semantics chặt hơn:

```text
Canonical AKG

Credential C
Identity U
Session on Host A
Service SMB on Host B
```

Từ facts trên, reasoner mới tạo:

```text
CandidateTransition:
  kind = credential_reuse
  source = Host A
  target = Host B
  confidence = 0.82
```

Sau khi thật sự execute thành công:

```text
Session on Host B
```

mới xuất hiện trong canonical state.

Tức là:

```text
FACT
  ↓
INFERENCE
  ↓
CANDIDATE ACTION
  ↓
EXECUTION
  ↓
OBSERVATION
  ↓
NEW FACT
```

Đây là architecture phù hợp hơn cho autonomous system vì LLM/planner không được tự “biến suy luận thành thực tế”.

Cũng cần công bằng rằng Decepticon hiện đã có `Candidate`, `Hypothesis` và thậm chí có cơ chế không cho low-confidence technology detection tự drive exploit chain. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docs/adr/0007-ai-surface-technology-node.md?utm_source=chatgpt.com)) Vì vậy đóng góp của Raptix không phải “Decepticon không phân biệt fact/inference”, mà là:

> **Raptix biến sự phân biệt đó thành invariant chung của toàn bộ reasoning pipeline.**

---

### 2. Shortest graph path không phải lúc nào cũng là attack plan

Đây là hạn chế mang tính mô hình hóa.

Một heterogeneous KG có thể chứa:

```text
Credential
   ↓
Identity
   ↓
Group
   ↓
Asset
   ↓
Service
   ↓
Vulnerability
```

Một đường đi giữa hai node có thể hoàn toàn đúng về relationship nhưng không cho ta biết:

```text
cần hành động nào?
precondition là gì?
tool nào làm được?
đã thử chưa?
xác suất thành công?
OPSEC cost?
hành động thành công sẽ tạo state nào?
```

Decepticon design hiện mô tả shortest-path bằng APOC Dijkstra trên các edge `EXPLOITS|ENABLES|LEAKS|LEADS_TO|PIVOTS_TO|ESCALATES_TO`. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/design/attack-graph-schema.md?utm_source=chatgpt.com))

Raptix thêm một tầng:

```text
AKG
 ↓
Reasoning
 ↓
Planning projection
 ↓
Executable transitions
 ↓
Planner
```

Ví dụ:

```text
Session(A,user)
      │
      │ credential_reuse
      ▼
Session(B,svc_backup)
      │
      │ privilege_escalation
      ▼
Session(B,root)
```

Planner tìm path trên **actions có thể thực hiện**, không phải trên toàn bộ semantic relationships.

Đây cũng là điểm quan trọng nhất nếu sau này bạn muốn dùng RL/HRL.

---

### 3. Raptix cần provenance mạnh hơn vì AI tự hành động

Decepticon đã làm khá tốt việc lưu output engagement: findings là Markdown, recon/exploit/post-exploit artifacts ở workspace và Neo4j lưu attack graph. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/engagement-workflow.md?utm_source=chatgpt.com))

Nhưng Raptix muốn nâng provenance thành model:

```text
Action
  │ PRODUCED
  ▼
Evidence
  │ SUPPORTS
  ▼
Finding
```

Từ đó có thể query trực tiếp:

```text
FIND-012
   ↓
EVID-293
   ↓
ACTION-183
   ↓
skill=credential-reuse
tool=netexec
target=10.0.2.15
result=success
phase=NETWORK_PROPAGATION
```

Đây quan trọng hơn đối với autonomous red team so với pentest assistant bình thường, bởi vì hệ thống phải **tự chứng minh vì sao nó tin vào một kết luận**.

Raw content vẫn để artifact store:

```text
Neo4j → structure/state/provenance
Markdown/log/png/json → content
```

Không nhét mọi thứ vào graph.

---

### 4. Có bằng chứng thực tế cho việc cần graph access boundary

Đây là lý do khách quan rất mạnh, không chỉ là “clean architecture”.

Decepticon từng phải sửa một lỗi mà `KGStore` có engagement scope nhưng các legacy graph helper quanh nó không enforce đầy đủ. `plan_attack_chains` chạy raw Cypher qua `query_custom`, và trong shared graph có thể tạo cross-engagement read/write. Version 1.1.40 sau đó bắt buộc query phải bind `$engagement`. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/CHANGELOG.md))

Tức là kiến trúc:

```text
Agent / Planner
      ↓
 raw Cypher
      ↓
    Neo4j
```

đã thực sự sinh ra bug class.

Raptix muốn:

```text
Planner
   ↓
GraphQueryService
   ↓
AttackGraphRepository
   ↓
Neo4j
```

Vì vậy việc thêm repository/query boundary **không phải abstraction thừa**, mà nhằm ngăn một loại lỗi đã xảy ra ở baseline.

Lưu ý: Decepticon hiện đã fix vấn đề này. Claim đúng là Raptix muốn **ngăn lớp lỗi đó bằng architecture**, không phải Decepticon hiện tại vẫn bị leak.

---

### 5. Graph cần phục vụ phase reasoning, không chỉ attack-path lookup

Mục tiêu Raptix giờ không chỉ là:

```text
entry → crown jewel
```

mà phải biết engagement đang ở đâu:

```text
INITIAL_FOOTHOLD
        ↓
NETWORK_PROPAGATION
        ↓
ACTION_ON_OBJECTIVES
```

Graph phải giúp trả lời:

```text
Có verified foothold chưa?
Có internal reachable surface chưa?
Có credential nào tái sử dụng được?
Objective cần privilege/access gì?
Hiện đã có session đáp ứng objective chưa?
```

Nhưng **Phase không phải node graph**.

AKG cung cấp facts:

```text
Session
Credential
Identity
Asset
Objective
...
```

PhaseEngine derive:

```text
current_phase
```

Nhờ vậy phase transition không phụ thuộc vào việc LLM nói:

> “Tôi nghĩ bây giờ nên chuyển sang post-exploitation.”

Mà phụ thuộc state đã xác minh.

---

### 6. Decepticon graph càng phát triển càng có nguy cơ trở thành domain ontology khổng lồ

ADR của chính Decepticon về `Technology` node nói rõ việc thêm một node kind là quyết định schema có ảnh hưởng public API và tạo thêm burden bảo trì. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docs/adr/0007-ai-surface-technology-node.md?utm_source=chatgpt.com))

Khi một red-team framework hỗ trợ:

```text
Web
AD
Cloud
AI surface
Container
Mobile
IoT
ICS
Wireless
...
```

nếu mọi khái niệm mới đều đi thẳng vào core graph schema thì core sẽ liên tục phình.

Raptix vì vậy nên theo:

```text
Small canonical ontology
        +
Extensible domain ontology
```

Ví dụ core biết:

```text
Asset
Identity
Credential
Session
Action
Evidence
Finding
```

Domain AD có thể thêm:

```text
DomainController
GPO
CertificateTemplate
```

mà planner core không bắt buộc hiểu toàn bộ.

---

## Vậy câu trả lời ngắn nhất cho “tại sao phải cải tiến?”

Không nên nói:

> **“Graph Decepticon yếu nên phải thay.”**

Mà nên nói:

> **“Attack graph của Decepticon đã cung cấp nền tảng tốt cho persistent state và path planning, nhưng khi mở rộng sang autonomous multi-host red teaming dài hạn, Raptix cần semantics chặt hơn giữa observed facts, inferred possibilities và executed actions; provenance có thể truy vết tới execution; graph access ít phụ thuộc backend; và một planning representation phù hợp với phase-aware orchestration. Vì vậy Raptix cải tiến graph không nhằm thay Neo4j hay tăng số node, mà nhằm tách rõ state, reasoning, execution và planning.”**

Nếu cần rút xuống đúng **4 lý do cốt lõi để đưa vào báo cáo**, mình sẽ dùng:

1. **Tách fact khỏi inference** để LLM không biến giả thuyết thành state.
2. **Tách semantic graph khỏi planning graph** để attack path tương ứng với hành động executable.
3. **Bổ sung first-class Action/Evidence provenance** để mọi finding và state change có thể kiểm chứng.
4. **Tách graph interface khỏi Neo4j/raw Cypher và gắn graph state với phase orchestration**, nhằm tăng isolation, maintainability và chuẩn bị cho planner/HRL sau này.

Bốn điểm này là phần có thể defend tốt nhất; các điểm khác chủ yếu là hệ quả kiến trúc của chúng.

---

**Sources:**

- [Decepticon/docker-compose.yml at main · BitterSecurity/Decepticon · GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docker-compose.yml?utm_source=chatgpt.com)

## Prompt:
06/10/2026, 11:00:13

cách thức lưu attack path để tận dụng khi kiểm thử là gì?

## Response:
06/10/2026, 11:00:28 · gpt-5-6-thinking

> **Thiết kế lưu attack path**
>
> Mình đang tách `attack path` thành hai lớp: bản mẫu có thể tái sử dụng và lần chạy thực tế. Mỗi path nên tham chiếu graph version, node/action IDs, điều kiện, bằng chứng, trạng thái, chi phí và kết quả để replay, regression-test, so sánh drift mà không phụ thuộc snapshot tùy ý.
>
> **Designed attack path storage**
>
> 
>
> Worked for 10s

Nên lưu **attack path**, nhưng không nên coi nó là “sự thật” ngang hàng với Asset/Session/Credential trong AKG. Với Raptix, mình sẽ tách thành **canonical graph state → derived AttackPath → execution trace**. Cách này vừa tận dụng được path khi kiểm thử, vừa tránh việc một path cũ làm ô nhiễm state hiện tại.

### 1. `AttackPath` nên là một snapshot có version

Ví dụ planner tại `graph_revision=183` suy ra:

```text
Session(web01, www-data)
        │
        │ credential_reuse
        ▼
Session(fs01, svc_backup)
        │
        │ privilege_escalation
        ▼
Session(fs01, root)
        │
        │ lateral_movement
        ▼
Session(dc01, administrator)
```

Không nên biến các bước trên thành canonical edge kiểu:

```text
web01 ──LEADS_TO──> fs01 ──LEADS_TO──> dc01
```

mà lưu một `AttackPath` riêng:

```yaml
path_id: AP-001
engagement_id: ENG-001

source_state:
  session_id: S-012

objective_id: OBJ-001

graph_revision: 183
phase: network_propagation

planner_version: raptix-planner-v2
cost_model_version: cost-v1

status: candidate

score: 0.81
estimated_cost: 4.2
confidence: 0.87
opsec_risk: 0.25

transitions:
  - id: T-001
    capability: credential_reuse
    source: S-012
    target: asset:fs01

  - id: T-002
    capability: privilege_escalation
    source: asset:fs01
    target: asset:fs01

  - id: T-003
    capability: lateral_movement
    source: asset:fs01
    target: asset:dc01
```

Điểm quan trọng nhất là:

```text
graph_revision
```

Vì path này chỉ đúng đối với state mà planner nhìn thấy tại thời điểm đó.

---

## 2. Nên phân biệt `AttackPath` và `AttackTrace`

Đây là distinction rất hữu ích cho testing.

**AttackPath** = planner dự đoán có thể đi.

**AttackTrace** = những gì hệ thống thực sự đã làm.

Ví dụ:

```text
AttackPath AP-001

A → B → C → D
```

nhưng runtime thực tế:

```text
AttackTrace AT-001

A
 ↓ credential_reuse FAILED
 B

A
 ↓ exploit_alt SUCCESS
 C
 ↓ lateral_movement SUCCESS
 D
```

Do đó bạn có thể đo trực tiếp:

```text
planned path
vs
executed path
```

và trả lời:

- planner dự đoán đúng bao nhiêu bước?
- bao nhiêu transition không executable?
- bao nhiêu lần replanning?
- hệ thống có lặp lại failed branch không?
- path thực tế dài hơn optimal path bao nhiêu?

Đây là dữ liệu rất giá trị để benchmark chính kiến trúc graph.

---

# 3. Mỗi transition nên là object riêng

Đừng lưu attack path đơn giản là:

```json
["web01", "fs01", "dc01"]
```

Vì nó gần như vô dụng để test.

Nên lưu:

```yaml
transition_id: T-002

kind: privilege_escalation

from:
  session: S-021

target:
  asset: fs01

preconditions:
  - verified_session
  - local_shell
  - linux_target

capability:
  privilege_escalation

expected_effect:
  session_privilege: root

estimated:
  success_probability: 0.72
  cost: 1.4
  opsec_risk: 0.18

status: proposed
```

Sau khi chạy:

```yaml
execution:
  action_id: A-334
  status: success

observed_effect:
  session_id: S-025
  privilege: root
```

Nhờ vậy một transition có lifecycle:

```text
PROPOSED
   ↓
SELECTED
   ↓
ATTEMPTED
   ├── FAILED
   └── SUCCEEDED
```

---

# 4. Successful path không nên biến thành “luật”

Ví dụ hôm nay:

```text
web01
 → reuse svc_backup
 → fs01
 → sudo misconfiguration
 → root
```

thành công.

Không nên vì vậy tạo permanent rule:

```text
web01 ALWAYS_LEADS_TO fs01
```

Lần test sau:

- password có thể đổi;
- service có thể đóng;
- ACL có thể đổi;
- user có thể mất privilege.

Nên lưu successful path như **historical episode**:

```text
AttackTrace:
  outcome: success
  environment_fingerprint: ...
  graph_revision_start: 183
  graph_revision_end: 201
```

Sau này planner có thể dùng nó như prior:

```text
historically successful
```

nhưng vẫn phải kiểm tra current preconditions.

---

# 5. Vậy nên lưu ở đâu?

Mình sẽ dùng hybrid giống Finding/Evidence.

### Trong graph

Lưu metadata và relation:

```text
(:AttackPath {
    id: "AP-001",
    graph_revision: 183,
    status: "candidate",
    score: 0.81
})
```

Quan hệ:

```text
AttackPath ──STARTS_FROM──> Session
AttackPath ──TARGETS──────→ Objective
AttackPath ──CONTAINS─────→ Transition
```

Transition có thể tham chiếu:

```text
Transition ──TARGETS──→ Asset
Transition ──REQUIRES─→ Credential
```

Nếu muốn graph reasoning/query tốt.

### Trong artifact store

Lưu full snapshot:

```text
attack-paths/
├── AP-001.json
├── AP-002.json
└── traces/
    ├── AT-001.json
    └── AT-002.json
```

Graph chỉ giữ:

```text
artifact_ref
```

Cách này tránh Neo4j bị phình bởi mọi planner detail.

---

# 6. Nhưng phần quan trọng nhất là tận dụng AttackPath cho testing

Mình sẽ tạo thêm khái niệm:

```text
AttackPathFixture
```

Ví dụ một lab có ground truth:

```yaml
fixture_id: LAB-AD-001

initial_state:
  foothold: web01

objective:
  asset: dc01
  privilege: administrator

expected_paths:
  - transitions:
      - credential_reuse
      - privilege_escalation
      - lateral_movement

allowed_alternatives:
  - transitions:
      - credential_reuse
      - lateral_movement
      - privilege_escalation

forbidden:
  - target: out_of_scope_host
```

Sau đó test planner:

```text
Fixture
   │
   ▼
Seed AKG
   │
   ▼
GraphReasoner
   │
   ▼
Generated AttackPaths
   │
   ▼
Compare with ground truth
```

Và đo:

```text
valid transition precision
valid transition recall
invalid-path rate
objective-reachable recall
path cost regret
```

Đây là cách rất sạch để test AKG **mà chưa cần chạy LLM hoặc khai thác thật**.

---

# 7. Sau đó mới đến integration test

Ví dụ graph fixture nói expected path là:

```text
S1
 ↓ cred-reuse
S2
 ↓ privesc
S3
 ↓ lateral
S4
```

Unit reasoning test chỉ cần kiểm tra:

```text
planner có sinh đúng candidate path không?
```

Integration test mới kiểm tra:

```text
tool thực thi transition đó có tạo đúng state mới không?
```

End-to-end test mới kiểm tra:

```text
agent có đi hết path tới objective không?
```

Tức là ba tầng:

```text
Graph fixture test
        ↓
Transition integration test
        ↓
End-to-end mission test
```

Điều này rất phù hợp nếu bạn muốn chứng minh Raptix ≥ Decepticon mà không cần benchmark khổng lồ.

---

# 8. Attack path còn giúp test regression cực tốt

Giả sử phiên bản `v0.3` sinh:

```text
AP-001
A → B → D
```

sau khi refactor planner, `v0.4` lại sinh:

```text
A → C → X
```

trong đó X không executable.

Bạn có thể phát hiện regression ngay.

Lưu:

```text
planner_version
graph_revision
cost_model_version
skill_corpus_version
```

vào path.

Sau đó snapshot test:

```text
same graph fixture

planner-v1
vs
planner-v2
```

không cần chạy cả lab.

---

# 9. Đừng assert exact path quá cứng

Đây là lỗi testing dễ mắc.

Một objective có thể có:

```text
A → B → D
```

và:

```text
A → C → D
```

đều hợp lệ.

Vì vậy test không nên luôn là:

```python
assert result == ["A", "B", "D"]
```

mà nên kiểm tra:

```text
objective reachable
all transitions executable
no forbidden transition
cost <= threshold
required invariants satisfied
```

hoặc:

```text
generated path ∈ allowed_paths
```

Như vậy planner vẫn có quyền tìm path mới tốt hơn.

---

# 10. `stale` là status bắt buộc

AttackPath phải có lifecycle kiểu:

```text
CANDIDATE
SELECTED
EXECUTING
SUCCEEDED
FAILED
STALE
```

Ví dụ path được sinh ở:

```text
graph_revision = 183
```

nhưng hiện graph đã là:

```text
revision = 211
```

và credential trong path bị revoke.

Path phải được đánh:

```text
STALE
```

không được planner tiếp tục dùng như plan hiện tại.

Có thể revalidate path bằng preconditions trước khi execute.

---

# 11. Replanning phải tạo path/version mới

Ví dụ:

```text
AP-001
A → B → C → D
```

B → C fail.

Không nên sửa AP-001 tại chỗ thành:

```text
A → B → X → D
```

Vì mất audit history.

Tạo:

```text
AP-002
parent_path_id: AP-001
replan_reason: T-002 failed
```

Thành:

```text
AP-001
A → B → C → D
        X failed

          │ replanning
          ▼

AP-002
A → B → X → D
```

Sau này bạn đo được:

```text
replan count
failure recovery rate
branch diversity
```

---

# 12. Đây cũng là chỗ tốt để chuẩn bị cho HRL

Sau này nếu đưa HRL vào, mỗi transition đã gần như action-space rồi:

```text
state_t
   ↓
CandidateTransitions
   ↓
choose T_i
   ↓
execute
   ↓
state_t+1
```

AttackTrace tạo ra dataset:

```text
(state,
 action,
 result,
 next_state,
 cost,
 reward)
```

Ví dụ:

```text
S_t:
  sessions=...
  credentials=...
  phase=NETWORK_PROPAGATION

Action:
  credential_reuse(target=fs01)

Outcome:
  success

S_t+1:
  new_session=fs01

Reward:
  +objective_progress
  -tool_cost
  -risk
```

Nghĩa là việc lưu attack path/trace tốt ngay từ bây giờ sẽ giúp rất nhiều nếu sau này bạn thật sự thử HRL.

---

## Chốt thiết kế mình khuyên dùng

Đừng lưu AttackPath như một chuỗi edge cố định trong canonical AKG.

Hãy dùng:

```text
Canonical AKG
     │
     ▼
Graph Reasoner
     │
     ▼
AttackPath snapshot
     │
     ├── Transition 1
     ├── Transition 2
     └── Transition N
     │
     ▼
Execution
     │
     ▼
AttackTrace
     │
     ▼
new canonical AKG state
```

Và khi kiểm thử:

```text
AttackPathFixture
       │
       ▼
Known AKG state
       │
       ▼
Reasoner / Planner
       │
       ▼
Generated AttackPath
       │
       ├── correctness test
       ├── optimality test
       ├── regression test
       └── execution test
```

Nếu mục tiêu là **tận dụng graph để benchmark chính Raptix**, thì mình xem `AttackPathFixture + AttackPath + AttackTrace` là bộ ba quan trọng nhất: **fixture cho ground truth, path cho quyết định của planner, trace cho những gì thật sự xảy ra**.

## Prompt:
06/10/2026, 13:33:27

knowledge graph sẵn có của decepticon lưu những gì? có được dùng như shared memory trong quá trình chạy không?

## Response:
06/10/2026, 13:33:35 · gpt-5-6-thinking

> **Searched 1 website**
>
> 
>
> Worked for 21s

Có, nhưng nên gọi chính xác là **shared operational memory**, không phải “shared conversational memory”.

Decepticon hiện dùng Neo4j như một **persistent attack-chain memory** cho engagement: tài liệu setup mô tả Neo4j là “Knowledge graph - persistent attack chain memory”, và trong autonomous execution orchestrator “tracks progress in Neo4j knowledge graph” rồi thích ứng chiến lược theo findings. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docs/setup-guide.md?utm_source=chatgpt.com))

### Knowledge graph của Decepticon lưu gì?

Schema hiện tại khá rộng. Theo design/schema và ADR của repo, nó lưu các nhóm chính như:

- **Attack surface / topology:** `Host`, `Network`, `Domain`, `Service`, `URL`, `CloudResource`, `Container`, `Technology`.
- **Identity/access:** `User`, `Group`, `Credential`, `Secret`, `Session`.
- **Vulnerability / code/security state:** `Vulnerability`, `CVE`, `Misconfiguration`, `Weakness`, `Repository`, `SourceFile`, `CodeLocation`.
- **Attack reasoning:** `Entrypoint`, `CrownJewel`, `AttackPath`, `Hypothesis`, `Candidate`, `Technique`.
- **Output/remediation:** `Finding`, `Patch`.

Design document của Decepticon mô tả mapping các node như Host, Service, URL, Repository, Vulnerability, Finding, Credential, User, Entrypoint, CrownJewel, AttackPath, Hypothesis và Candidate; schema mở rộng thêm Network, Domain, CloudResource và Container. Gần đây repo còn thêm `Technology` để lưu technology detection có version và provenance. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/design/attack-graph-schema.md?utm_source=chatgpt.com))

Các entity không đứng riêng lẻ. Graph còn lưu quan hệ kiểu attack chain/topology/access, chẳng hạn một service thuộc host, credential gắn với identity, các quan hệ có thể dẫn tới pivot/escalation/attack path, v.v. Decepticon dùng các quan hệ đó để hỗ trợ attack-chain planning và visualization. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/design/attack-graph-schema.md?utm_source=chatgpt.com))

### Nó có phải shared memory giữa các agent không?

**Có ở cấp hệ thống, nhưng không theo cách “mọi agent đều được nhét toàn bộ graph vào prompt”.**

Decepticon cố tình thiết kế mỗi specialist với **fresh context window cho từng objective**. Tài liệu agents nói rõ findings được persist vào `workspace/` và knowledge graph, **không nằm trong agent memory**. Khi agent mới được spawn, nó chỉ nhận objective, RoE và relevant findings, thay vì toàn bộ history của agent trước. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/agents.md?utm_source=chatgpt.com))

Vì vậy flow gần đúng là:

```text
Agent A
   │
   ├── discovers host/service/credential/finding
   │
   ▼
Workspace + Neo4j KG
   │
   │ persistent across objectives
   ▼
Orchestrator / Agent B
   │
   └── reads relevant state/findings
```

Nói cách khác:

```text
LLM context
= short-lived local working memory

Workspace
= persistent human-readable/artifact memory

Neo4j KG
= persistent structured shared operational memory
```

Đây là distinction quan trọng.

### Nhưng graph có tự động được inject vào mỗi model call không?

Không nên hiểu như vậy.

Tài liệu hiện tại cho thấy những thứ được inject thường xuyên vào model context là các middleware như `EngagementContextMiddleware` và `OPPLANMiddleware`; specialist được spawn với relevant findings. Graph tồn tại như persistent state/query substrate, chứ không phải toàn bộ graph được serialize rồi nhét vào prompt mỗi turn. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/agents.md?utm_source=chatgpt.com))

Do đó mô hình thực tế gần hơn với:

```text
                 Persistent state
                ┌───────────────┐
                │     Neo4j     │
                │      KG       │
                └───────┬───────┘
                        │ query / ingest
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
      Recon Agent   Exploit Agent  PostExploit
          │             │             │
          └─────────────┼─────────────┘
                        │
                   Orchestrator
```

chứ không phải:

```text
Neo4j
  ↓
dump everything
  ↓
every agent prompt
```

Đó cũng là lý do Decepticon có thể giữ context window sạch trong engagement dài. README và tài liệu agents nhấn mạnh mỗi objective dùng fresh context để tránh accumulated noise/context degradation. ([GitHub](https://github.com/BitterSecurity/Decepticon?utm_source=chatgpt.com))

### Có hai loại graph, đừng nhầm

Decepticon hiện còn có **Skillogy**, cũng dựa trên Neo4j. Nhưng nó khác engagement KG.

Architecture docs nói rõ Skillogy Neo4j **không phải cùng instance/schema với engagement KGStore**; hai graph có schema và write semantics khác nhau. Skillogy là graph dùng để tìm skill, technique, prerequisite, tool, asset type..., còn engagement KG là attack-chain state của một lần pentest/red-team. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/architecture.md?utm_source=chatgpt.com))

Có thể hiểu:

```text
Engagement KG
"What do we currently know about this target?"
        │
        ├── hosts
        ├── services
        ├── credentials
        ├── sessions
        ├── findings
        └── attack paths

Skill Graph
"What does Raptix/Decepticon know how to do?"
        │
        ├── skills
        ├── techniques
        ├── prerequisites
        └── tools
```

### Điều này ảnh hưởng trực tiếp tới proposal Raptix

Điểm này làm rõ rằng **Raptix không nên claim “Decepticon không có shared memory nên ta thêm AKG”**. Claim đó sai.

Decepticon đã có shared structured memory khá rõ.

Raptix đang muốn cải tiến **cách shared memory đó được mô hình hóa và tiêu thụ**:

```text
Decepticon
persistent KG
   +
attack-chain relationships
   +
agent/workspace findings
```

thành rõ ràng hơn:

```text
Raptix
Canonical engagement state
        │
        ├── facts
        ├── provenance
        ├── Action / Evidence
        └── verified sessions
              │
              ▼
       Reasoning projection
              │
              ▼
      CandidateTransitions
              │
              ▼
        Phase / Planner
```

Tức là giá trị của Raptix không nằm ở chuyện **“có graph làm shared memory”**, vì baseline đã có rồi. Nó nằm ở việc cố gắng biến graph từ **persistent attack-chain memory** thành một **canonical operational state có boundary rõ giữa fact, inference, execution và provenance**.

Nếu cần nói cực ngắn: **Decepticon KG đã là shared memory của engagement, nhưng là shared memory ở cấp structured operational state; agent context vẫn ngắn và tách biệt. Raptix nên kế thừa mô hình đó, không thay thế nó, rồi cải tiến semantics và reasoning layer ở phía trên.**

---

**Sources:**

- [Decepticon/docs/setup-guide.md at main · BitterSecurity/Decepticon · GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docs/setup-guide.md?utm_source=chatgpt.com)

## Prompt:
06/10/2026, 15:07:11

vậy việc áp dụng sửa đổi graph cho raptix có gì đặc biệt so với decepticon? nói những phần thật sự khác biệt chứ nếu chỉ khác 1 chút thì vô nghĩa

## Response:
06/10/2026, 15:07:15 · gpt-5-6-thinking

> **Distilling real differences**
>
> I’m separating architectural changes from renamed graph objects. The genuinely different ideas are: one canonical state graph, graph-derived phase guards, and execution/evidence provenance as first-class state. Anything else is mostly packaging unless it changes runtime decisions.
>
> **Distilled real differences**
>
> 
>
> **Sharpening differentiation**
>
> I’m narrowing this to one defensible novelty: replacing attack-path traversal with verified state-transition planning, where actions declare preconditions, effects, evidence, cost, and risk. Separate graphs, typed nodes, and phase labels alone aren’t meaningfully different from the existing design.
>
> **Sharpened differentiation**
>
> 
>
> **Searched 1 website**
>
> 
>
> Worked for 52s

Nếu yêu cầu là **“phải khác Decepticon ở mức kiến trúc, chứ không phải đổi tên node/edge”**, thì mình sẽ thu hẹp proposal của Raptix xuống **3 khác biệt thực sự đáng làm**. Phần lớn những gì ta từng bàn như Neo4j, typed nodes, shared memory, `AttackPath`, Candidate/Hypothesis, findings Markdown, persistent state, skill graph… **không đủ để coi là đóng góp**, vì Decepticon hiện đã có chúng. Decepticon thậm chí gọi Neo4j là “persistent working memory”, dùng graph xuyên domain và lưu attack path phục vụ multi-hop planning. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/architecture.md?utm_source=chatgpt.com))

## 1. Khác biệt lớn nhất: từ **attack graph** sang **state-transition model**

Đây là thay đổi đáng giá nhất.

Decepticon hiện mô hình hóa attack progression ngay trong graph bằng các entity/relationship như `Entrypoint`, `CrownJewel`, `AttackPath`, `LEADS_TO`, `ENABLES`, `PIVOTS_TO`, `ESCALATES_TO` rồi dùng graph/path search để tìm chuỗi tấn công. Schema của nó còn có `Candidate` và `Hypothesis`, nên không thể nói Decepticon “không biết fact với hypothesis”. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/design/attack-graph-schema.md?utm_source=chatgpt.com))

Raptix nên thay đổi abstraction sâu hơn:

```text
Decepticon-ish

Operational KG
    │
    ├── Host
    ├── Credential
    ├── Vulnerability
    ├── CAN_ACCESS
    ├── PIVOTS_TO
    └── LEADS_TO
           │
           ▼
      shortest/path search
```

thành:

```text
Raptix

Canonical World State
        │
        ▼
 Transition Generator
        │
        ▼
CandidateTransition[]
        │
        ▼
 Planner / Policy
        │
        ▼
     Execute
        │
        ▼
 Observation
        │
        ▼
Canonical World State'
```

Tức là canonical AKG **không lưu “đường có thể đi” như một sự thật ngang hàng với “thứ đã biết”**.

Ví dụ graph chỉ biết:

```text
Session(web01, www-data)
Credential(svc_backup)
Service(fs01, SMB)
```

Reasoner mới tạo:

```text
CandidateTransition {
    capability: credential_reuse,
    target: fs01,
    requires: [svc_backup, reachable_smb],
    expected_effect: authenticated_session,
    confidence: 0.81
}
```

Tool chạy thành công thì mới tạo:

```text
Session(fs01, svc_backup, verified=true)
```

Vậy semantics trở thành:

```text
OBSERVED FACT
      ↓
INFERENCE
      ↓
EXECUTABLE TRANSITION
      ↓
EXECUTION
      ↓
OBSERVATION
      ↓
NEW FACT
```

**Đây không phải thay schema chút ít. Đây là đổi bản chất của graph trong planner.**

Decepticon dùng graph vừa như knowledge representation vừa như attack-path substrate. Raptix sẽ dùng:

> **AKG để biểu diễn trạng thái thế giới; planning graph được derive từ AKG dưới dạng state/action transitions.**

Nếu implement đúng, đây là điểm đủ lớn để làm contribution.

---

## 2. `Action` và `Evidence` thành first-class provenance model

Đây là khác biệt thứ hai mình sẽ giữ.

Decepticon đã có provenance và đã ghi findings/artifacts ra workspace. Orchestration của nó persist findings, KG và các artifact giữa những fresh agent contexts. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/agents.md?utm_source=chatgpt.com))

Vì vậy chỉ nói:

> “Raptix lưu evidence.”

thì không khác.

Khác biệt phải là:

> **Execution itself trở thành một phần của graph semantics.**

Raptix:

```text
          Action
         /   |   \
        /    |    \
   TARGETS  USED  PRODUCED
      ↓      ↓       ↓
    Asset Credential Evidence
                        │
                     SUPPORTS
                        ↓
                     Finding
```

Ví dụ:

```text
Action A-091
├── capability = credential_reuse
├── skill = netexec-smb
├── phase = NETWORK_PROPAGATION
├── target = fs01
├── result = success
└── produced → E-044

Evidence E-044
├── artifact_ref = ...
├── sha256 = ...
└── supports → F-012
```

Khi đó bạn có thể query trực tiếp:

```text
Tại sao hệ thống tin rằng
svc_backup đăng nhập được fs01?

Session(fs01)
   ↑ CREATED_BY
Action A-091
   ↓ PRODUCED
Evidence E-044
```

Đây mạnh hơn provenance dạng:

```text
created_by = ...
source_episode_id = ...
```

vì hành động thực thi trở thành **entity có thể reason trên nó**.

Điều này còn giúp loại bỏ state phụ như `tried_edges`:

```text
Action(
    capability=lateral_movement,
    target=fs01,
    status=failed
)
```

đã đủ để reasoner biết nhánh đó vừa thất bại.

Với repo Raptix hiện tại, `tried_edges`, KG middleware, event log, evidence capability và reporting đang là các concern riêng rẽ; nếu gom được chúng quanh execution provenance thì đây là thay đổi architecture thực sự chứ không phải rename folder. `repo-structure.txt`

---

# 3. Graph không chỉ hỗ trợ planner - graph **điều khiển orchestration**

Đây là khác biệt lớn thứ ba.

Workflow hiện tại của Decepticon về cơ bản là:

```text
OPPLAN
  ↓
next pending objective
  ↓
objective.phase
  ↓
spawn corresponding agent
  ↓
execute
  ↓
update OPPLAN
  ↓
update findings / KG
```

Tài liệu của Decepticon mô tả chính xác loop này; objective đã mang `phase`, và orchestrator dispatch agent dựa trên phase của objective. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/engagement-workflow.md?utm_source=chatgpt.com))

Graph ở đây là operational memory và planning support, nhưng **OPPLAN/objective vẫn là control structure chính**.

Raptix nếu chỉ đổi:

```text
recon → initial-access → post-exploit
```

thành:

```text
Initial Foothold
Network Propagation
Action on Objectives
```

thì gần như **không có giá trị nghiên cứu**.

Khác biệt phải là:

```text
Objective
    │
    ▼
Canonical AKG
    │
    ▼
Phase Context
    │
    ▼
Phase Engine
    │
    ├── current phase
    ├── allowed capabilities
    └── transition guards
            │
            ▼
          Planner
```

Ví dụ:

```text
INITIAL_FOOTHOLD
```

không kết thúc vì LLM nói:

> “Tôi đã recon đủ rồi.”

Mà vì invariant:

```text
exists Session(
    status = verified,
    scope = engagement
)
```

Nếu đúng:

```text
INITIAL_FOOTHOLD
        ↓
NETWORK_PROPAGATION
```

Tương tự, Action on Objectives chỉ trở nên eligible khi graph chứng minh objective prerequisites đã đạt.

Đây là **graph-driven control plane**, khác với graph chỉ là memory/path database.

Và nó cũng sửa một điểm đang có trong báo cáo hiện tại của bạn: report cũ mô tả AKG là nguồn sự thật trung tâm và phase transition dựa trên graph, nhưng vẫn mô hình hai pha và có những claim về Decepticon KG quá mạnh như “chỉ dùng cho path planning tĩnh”. `_Intern_Report__AI_Autonomous_Red_Team.pdf` Phần này nên được viết lại theo architecture mới.

---

# Ba thay đổi đó kết hợp lại mới tạo ra cái “đặc biệt”

Từng cái riêng lẻ chưa đủ mạnh.

Kết hợp lại thì architecture biến thành:

```text
              ┌──────────────────────────┐
              │  Canonical Attack State  │
              │          AKG             │
              └────────────┬─────────────┘
                           │
            ┌──────────────┼───────────────┐
            │              │               │
            ▼              ▼               ▼
      Phase Engine   Transition Engine   Provenance
            │              │               │
            │              ▼               │
            │      CandidateTransitions    │
            │              │               │
            └──────────┐   │   ┌───────────┘
                       ▼   ▼
                      Planner
                        │
                        ▼
                  Capability/Skill
                        │
                        ▼
                      Action
                        │
                 ┌──────┴──────┐
                 ▼             ▼
             Evidence      Observation
                 │             │
                 ▼             ▼
              Finding    Canonical AKG'
```

Đây là khác biệt đáng kể.

Graph không còn chỉ là:

> database lưu attack chain.

Mà nó đóng ba vai trò tách biệt:

```text
1. State substrate
2. Planning-state source
3. Execution provenance ledger
```

và hai subsystem derive từ state:

```text
Phase Engine
Transition Engine
```

---

# Một hệ quả cực kỳ quan trọng: planner action space trở nên hữu hạn

Đây là lý do mình nghĩ kiến trúc trên đặc biệt phù hợp cho Raptix.

Decepticon specialist agent hiện có toolset và LLM quyết định thao tác trong objective; fresh context + skill + tool architecture của nó đã khá mạnh. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/architecture.md?utm_source=chatgpt.com))

Raptix có thể đưa planner lên abstraction:

```text
Planner KHÔNG chọn:

netexec smb 10.0.2.15 ...
certipy ...
ssh ...
ligolo ...
```

Planner chọn:

```text
credential_reuse
privilege_escalation
establish_pivot
internal_discovery
lateral_movement
objective_action
```

Nhưng còn hơn Incalmo-style verb:

planner không được tự invent action.

Action space đến từ graph:

```text
AKG state
    │
    ▼
Transition Generator
    │
    ├── T1 credential_reuse → fs01
    ├── T2 privesc → web01
    └── T3 discover → subnet-B
```

Planner chỉ chọn:

```text
T1 | T2 | T3
```

Đây là distinction lớn.

Nó biến bài toán từ:

```text
LLM:
"What should I do next?"
```

thành:

```text
System:
"These are the currently valid state transitions."

LLM:
"Which one should I choose?"
```

Đó là một reduction rất lớn của decision space.

---

# Đây cũng là điểm kết nối HRL thật sự có ý nghĩa

Trước đây bạn hỏi liệu framework kiểu Incalmo có phù hợp HRL.

Nếu Raptix implement transition layer như trên, câu trả lời trở nên rõ hơn.

Bạn có:

```text
state S_t
    ↓
valid transitions A(S_t)
    ↓
policy chooses a_t
    ↓
execution
    ↓
state S_t+1
```

Tức là:

```text
S_t
= structured graph projection

A(S_t)
= CandidateTransition[]

a_t
= selected transition

reward
= objective progress
  - cost
  - OPSEC risk
  - failed attempt
```

Đây gần như là interface mà RL cần.

Không cần để RL học:

```text
"nên gõ shell command nào?"
```

Nó chỉ học:

```text
"trong số các transition hợp lệ, nên chọn cái nào?"
```

Vì vậy **state-transition AKG** không chỉ là một cách vẽ graph khác; nó mở ra architecture để thay policy selector:

```text
LLM policy
    ↓
Jev/scorer
    ↓
RL
    ↓
HRL
```

mà không rewrite execution.

---

# Những thứ mình sẽ KHÔNG gọi là khác biệt

Để tránh proposal bị “thổi phồng”, mình sẽ bỏ khỏi danh sách contribution:

- **Neo4j** - Decepticon đã dùng.
- **Graph làm shared memory** - Decepticon đã làm và thậm chí gọi Neo4j là persistent working memory. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/docker-compose.yml?utm_source=chatgpt.com))
- **Typed node / edge** - Decepticon có schema rất giàu. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/design/attack-graph-schema.md?utm_source=chatgpt.com))
- **AttackPath node** - Decepticon có.
- **Candidate/Hypothesis** - Decepticon có.
- **Finding Markdown / workspace artifacts** - Decepticon có. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/engagement-workflow.md?utm_source=chatgpt.com))
- **Persistent state ngoài LLM context** - Decepticon đã làm rất rõ.
- **Fresh-context specialist agents** - Decepticon đã làm. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/agents.md?utm_source=chatgpt.com))
- **Skill graph** - Skillogy đã tồn tại; nó dùng typed Neo4j graph trên `SKILL.md`. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/skillogy.md?utm_source=chatgpt.com))
- **Scope/provenance tagging** - Decepticon đã có và đã harden rất mạnh.
- **Event log / record-replay** - Decepticon hiện đã có append-only `events.jsonl` và record/replay. ([GitHub](https://github.com/BitterSecurity/Decepticon/blob/main/CHANGELOG.md?utm_source=chatgpt.com))
- **Repository wrapper quanh Neo4j** - nên làm, nhưng đây là software engineering improvement chứ không phải research contribution.

Tất cả vẫn đáng giữ, nhưng **không nên bán chúng như điểm mới**.

---

# Có một thay đổi thứ tư có thể đáng làm, nhưng mình xem là phụ

Đó là **typed graph projections cho từng agent**.

Decepticon specialist được tạo fresh context và đọc relevant findings/context, đồng thời có `kg_*` tools. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/agents.md?utm_source=chatgpt.com))

Raptix có thể mạnh tay hơn:

```text
Raw AKG
   ↓
State Projector
   ↓
role-specific view
```

Recon nhận:

```text
SurfaceView
```

Post-exploit nhận:

```text
AccessView
```

Planner nhận:

```text
PlanningState
```

PhaseEngine nhận:

```text
PhaseContext
```

Reporting nhận:

```text
EvidenceView
```

Không module nào đọc raw graph tùy ý.

Điều này tốt cho:

```text
token economy
schema decoupling
parallel-agent consistency
testing
```

Nhưng mình xem đây là **hệ quả của canonical-state architecture**, chưa đủ đứng riêng thành đóng góp số 4.

---

## Nếu bắt mình chốt proposal Raptix bằng đúng 3 câu

Mình sẽ không còn gọi nó là **“AKG hợp nhất”**, vì câu đó quá yếu và Decepticon vốn đã có cross-domain attack graph.

Mình sẽ định nghĩa contribution thành:

**1. Canonical State / Planning Separation.**  
Raptix tách persistent Attack Knowledge Graph chứa observed/verified state khỏi planning projection chứa các candidate state transitions, thay vì dùng cùng các attack relationships vừa làm knowledge vừa làm đường tìm kiếm.

**2. Execution-Centric Provenance.**  
Mỗi thay đổi state quan trọng được liên kết với first-class `Action` và `Evidence`, tạo provenance chain có thể kiểm tra từ observation/finding về execution thực tế.

**3. Graph-Governed Orchestration.**  
UKC phase và tập hành động hợp lệ được suy ra từ verified graph state qua deterministic transition policies; OPPLAN/LLM chọn chiến lược trong action space đó thay vì tự sở hữu lifecycle state.

Nếu Raptix **không implement được ba điều này ở mức runtime**, mình đồng ý với nhận xét của bạn: đổi graph sẽ chỉ là refactor nhẹ Decepticon và **không đáng coi là đóng góp cốt lõi**.

Còn nếu implement đầy đủ, thì sự khác biệt không còn là “Decepticon có graph A, Raptix có graph B”, mà là:

> **Decepticon dùng graph chủ yếu như persistent operational/attack-chain memory; Raptix biến graph thành formal state substrate cho một state-transition planning and orchestration architecture.**

Đó mới là hướng đủ khác để đáng đầu tư và đủ rõ để sau này benchmark xem nó có thực sự tốt hơn hay không.

