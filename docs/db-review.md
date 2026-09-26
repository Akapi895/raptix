# Vấn đề lớn nhất hiện tại

Nhìn riêng schema này dưới góc độ một **AI Red Team / automated pentest platform**, tôi đánh giá nó **khá tốt về control-plane và governance, nhưng hiện vẫn hơi “platform-heavy” và chưa đủ sâu ở offensive-security domain**.

Tổng thể tôi sẽ cho khoảng **8/10 cho nền tảng kiến trúc**, nhưng chỉ khoảng **6.5–7/10 nếu hỏi “đã đủ làm core database cho một hệ thống autonomous pentest hoàn chỉnh chưa?”**.

### Điểm mạnh nhất

Kiến trúc có separation khá sạch:

```
Project
 └── Scope
 └── Run
 ├── Task
 │ └── Agent Instance
 │ └── Agent Attempt
 │ └── Messages
 │
 ├── Tool Invocation
 │ └── Artifact
 │
 ├── Assets
 ├── Observations
 ├── Hypotheses
 ├── Coverage
 └── Findings
 ├── Evidence
 ├── Revisions
 ├── Verdicts
 └── Review History
```

Flow này đúng tư duy của autonomous security system: **agent không phải nguồn sự thật cuối cùng**. Agent tạo reasoning/action, execution được lưu riêng, evidence được lưu riêng, rồi finding lại có validation/revision/review riêng.

Đây là điểm tôi thích nhất trong schema này.

Đặc biệt tốt ở một số chỗ:

`scope_id` được pin trực tiếp vào `runs` và `tool_invocations`.

Có `capability_grants` + `approvals`.

Có `audit_records`.

`tool_invocations` có lifecycle rất rõ.

`request` được ghi là `sanitized args`.

Raw artifact và structured artifact tách riêng.

Findings không đơn giản chỉ là một bảng vulnerability.

Có `finding_revisions`.

Có `supporting | refuting | context` evidence.

Có verifier qua `finding_verdicts`.

Có `coverage_entries`, đây là phần nhiều pentest-agent system bỏ qua.

Có optimistic concurrency `version`.

Có idempotency.

Có queue River để execution/report chạy async.

Đối với hệ thống autonomous agent, những thứ này quan trọng hơn việc chỉ có:

```
agents
tools
vulnerabilities
reports
```

Schema của bạn rõ ràng đã vượt xa kiểu đó.

# Vấn đề lớn nhất hiện tại

Vấn đề không nằm ở engineering foundation.

Nó nằm ở chỗ **security-domain model còn mỏng**.

Hiện tại phần quan trọng nhất của pentest được biểu diễn bằng:

```
assets
observations
hypotheses
coverage_entries
findings
```

Nó khá generic.

Một autonomous red-team system thực tế sẽ phải hiểu những thứ kiểu:

```
Host
 └── Service
 └── Endpoint
 ├── Parameter
 ├── Technology
 ├── Authentication surface
 └── Vulnerability candidate

Credential
Session
Access
Privilege
Attack path
Exploit
Payload
Technique
Objective
```

Trong schema hiện tại, phần lớn những thứ này có lẽ phải nhét vào:

```
assets.properties jsonb
observations.detail
artifact
```

Điều này chạy được ở V1, nhưng càng phát triển thì agent càng khó query state.

Ví dụ sau recon:

```
10.10.1.5
 ├── 22/tcp SSH
 └── 443/tcp nginx
 └── https://app/
 ├── /login
 ├── /api/users?id=
 └── JWT authentication
```

Schema hiện tại sẽ khó biểu diễn topology này một cách first-class.

# Thiếu quan trọng số 1: Attack Graph / Relations

Bạn có `assets`, nhưng chưa có relation giữa assets.

Tôi gần như chắc chắn sau này bạn sẽ cần kiểu:

```
asset_relations

id
run_id
source_asset_id
target_asset_id
relation_type
properties
evidence_id
created_at
```

Ví dụ:

```
HOSTS
RUNS_SERVICE
EXPOSES_ENDPOINT
RESOLVES_TO
AUTHENTICATES_TO
DEPENDS_ON
CONNECTS_TO
TRUSTS
PIVOTS_TO
```

Sau đó hệ thống mới thực sự xây được:

```
Internet
 ↓
web.example.com
 ↓
/admin
 ↓
SQLi
 ↓
DB credential
 ↓
internal-db
```

Đây chính là cơ sở để planner reasoning về **attack path**, thay vì nhìn vào một bag of observations.

# Thiếu quan trọng số 2: Session / Foothold

Nếu mục tiêu của bạn chỉ là web scanner thì chưa cần.

Nhưng nếu gọi là **AI Red Team**, tôi nghĩ đây là khoảng trống lớn nhất.

Hiện không thấy:

```
sessions
credentials
access
privileges
```

Ví dụ:

```
sessions
--------
id
run_id
asset_id
source_invocation_id

kind
channel

principal
privilege_level

status

opened_at
last_seen_at
expires_at
closed_at
```

Một agent cần biết:

> Tôi đang có shell nào?

> Shell đó là user gì?

> Quyền gì?

> Trên host nào?

> Còn sống không?

> Có thể pivot từ đây sang đâu?

Nếu không có first-class session state, post-exploitation sẽ rất khó quản lý.

# Thiếu số 3: Credential model

Credential không nên chỉ là artifact.

Nên có abstraction kiểu:

```
credentials

id
run_id
asset_id

kind
username
secret_artifact_id

status

source
validated_at
expires_at
```

Secret thực tế vẫn để encrypted/protected evidence store.

DB chỉ giữ metadata.

Agent lúc đó có thể reasoning:

```
credential C1
 ↓ valid_for
SSH service
 ↓ grants
host A:user
```

Cái này cực kỳ quan trọng cho lateral movement.

# Thiếu số 4: Execution ↔ reasoning traceability

Hiện bạn có:

```
agent_message
 -> invocation_id
```

và:

```
tool_invocation
```

Nhưng tôi muốn có một abstraction mạnh hơn:

```
intent
 ↓
policy decision
 ↓
approval
 ↓
invocation
 ↓
artifact
 ↓
observation
 ↓
finding
```

Tức là có thể trả lời chính xác:

> Vì sao tool này được chạy?

> Agent nào đề xuất?

> Nó nhằm kiểm chứng hypothesis nào?

> Policy engine quyết định thế nào?

> Approval nào cho phép?

> Invocation nào thực thi?

Hiện schema có tất cả các mảnh, nhưng **chưa có chain rõ ràng nối chúng lại**.

Đây rất quan trọng đối với autonomous pentest.

# Thiếu số 5: Policy Decision

Bạn đã có:

```
capability_grants
approvals
audit_records
```

rất tốt.

Nhưng tôi sẽ thêm một entity kiểu:

```
policy_decisions

id
run_id
scope_id
actor

action
resource

decision
risk_level

rule_id
reason

approval_id

created_at
```

Ví dụ:

```
agent
 ↓
sqlmap --os-shell

Policy Engine
 ↓

HIGH RISK
 ↓
requires approval

Approval
 ↓
approved

Invocation
```

Đây sẽ là một trong những bảng quan trọng nhất nếu bạn muốn hệ thống autonomous nhưng vẫn governed.

# Thiếu số 6: Agent orchestration

Hiện tại:

```
agent_instances
task_id
profile
```

đủ cho flat agent system.

Nhưng nếu sau này có:

```
Recon Agent
 ├── DNS Agent
 ├── HTTP Agent
 └── Tech Detection Agent

Exploit Agent
 ├── SQLi Agent
 └── Auth Agent
```

thì chưa thấy:

```
parent_agent_id
spawned_by_agent_id
delegation_reason
```

Tôi sẽ ít nhất thêm self-reference:

```
parent_agent_id
```

vào `agent_instances`.

Không nhất thiết phải xây multi-agent tree ngay, nhưng DB nên chịu được nó.

# `tasks` hiện tại hơi yếu

Hiện:

```
tasks
- name
- status
```

là chưa đủ cho AI orchestration.

Ít nhất tôi sẽ nghĩ tới:

```
kind
goal
input
priority
assigned_agent_id
result
failure_reason
```

Hoặc giữ input/result ở artifact cũng được.

Nhưng quan trọng nhất là **goal**.

Pentest task không đơn giản là:

```
"Scan target"
```

mà thường là:

```
Goal:
determine whether authentication can be bypassed

Success criteria:
obtain authenticated access without valid credentials

Constraints:
no brute force
```

Planner cần semantic state này.

# `hypotheses` là một quyết định rất đúng

Tôi đặc biệt khuyên bạn **giữ bảng này**.

Ví dụ:

```
Hypothesis H1
"Parameter id may be injectable"

 ↓ tested_by

Invocation #34
sqlmap

 ↓ produced

Artifact #182

 ↓ observation

Response shows time delay

 ↓ verifier

confirmed
```

Đây là cách làm autonomous pentest tốt hơn kiểu:

```
scan -> detect vulnerability
```

Tôi thậm chí còn cân nhắc thêm:

```
hypothesis_evidence
```

hoặc relationship:

```
hypothesis_id
```

vào observation/invocation.

# `coverage_entries` cũng là điểm rất mạnh

Nó giải quyết một câu rất quan trọng:

> Agent **đã kiểm tra gì và chưa kiểm tra gì?**

Ví dụ:

```
SQL Injection verified_negative
XSS attempted
IDOR not_attempted
Authentication inconclusive
```

Đây là foundation tốt cho planner:

```
Attack Surface
 ↓
Hypotheses
 ↓
Coverage
 ↓
Next actions
```

Tôi sẽ không bỏ phần này.

# Finding model hiện tại gần như production-grade

Phần:

```
findings
finding_evidence
finding_revisions
finding_revision_evidence
finding_verdicts
finding_review_history
```

là một trong những phần mạnh nhất schema.

Nó xử lý được vấn đề thường gặp của AI pentester:

```
LLM says:
"This is SQL injection"
```

nhưng hệ thống không mặc định coi đó là vulnerability.

Thay vào đó:

```
observation
 ↓
hypothesis
 ↓
evidence
 ↓
finding draft
 ↓
verifier
 ↓
review
 ↓
confirmed
```

Đây là design rất hợp lý.

# Nhưng finding còn thiếu vulnerability semantics

Có thể thêm dần:

```
finding_classifications
```

hoặc vào finding:

```
cwe
owasp_category
cvss_vector
cvss_score
attack_technique
```

Tôi không khuyên nhét tất cả vào `findings` ngay.

Có thể:

```
finding_classifications
-----------------------
finding_id
scheme
identifier
```

Ví dụ:

```
CWE CWE-89
OWASP A03:2021
CAPEC CAPEC-66
MITRE T1190
```

Linh hoạt hơn nhiều.

# `artifacts` design tốt nhưng provenance có thể mạnh hơn

Hiện:

```
parent_id
rel_type
```

chỉ biểu diễn được gần giống một cây:

```
raw
 ↓
parsed
 ↓
normalized
```

Trong thực tế provenance có thể là DAG:

```
nmap XML ───┐
 ├─> asset graph
httpx JSON ─┘
```

Sau này có thể cần:

```
artifact_relations

source_artifact_id
target_artifact_id
relation_type
```

thay vì chỉ `parent_id`.

Không cần làm ngay.

# Một vấn đề kiến trúc tôi thấy rõ

Schema hiện tại thiên về:

```
Control Plane
Governance
Audit
Workflow
Evidence
Review
```

hơn là:

```
Offensive Security State
```

Nếu minh họa tỷ lệ hiện tại thì tôi cảm giác:

```
Platform / Governance █████████████████ rất tốt
Agent orchestration ███████████
Execution ██████████████
Evidence ████████████████
Finding validation █████████████████
Attack-surface modeling █████████
Foothold / access ███
Post exploitation ██
Attack-path reasoning ████
```

Đây không phải lỗi thiết kế.

Thực ra **đây là nền tảng tốt để bắt đầu**, vì governance/evidence rất khó retrofit về sau.

Nhưng phase tiếp theo nên chuyển trọng tâm khỏi infrastructure.

# Tôi sẽ phát triển DB theo thứ tự này

Không nên bổ sung hàng loạt bảng một lần.

Từ schema hiện tại, tôi sẽ đi:

```
1. Asset relations
 ↓
2. Hypothesis ↔ invocation ↔ observation links
 ↓
3. Policy decision / action intent
 ↓
4. Session / foothold
 ↓
5. Credential metadata
 ↓
6. Attack paths
 ↓
7. Agent delegation
 ↓
8. Vulnerability classification
```

Sau bước 1–3:

> hệ thống đã khá mạnh cho autonomous web pentest.

Sau bước 4–6:

> nó bắt đầu thực sự trở thành **red-team platform**, không còn chỉ là AI pentest/scanner.

## Kết luận

**Core architecture hiện tại là tốt và có tư duy production rõ ràng.** Tôi sẽ không redesign lại toàn bộ database.

Điểm tôi sẽ thay đổi về hướng phát triển là:

> **Dừng bổ sung infrastructure/control-plane trong một thời gian và bắt đầu làm sâu security-domain model.**

Nếu không, hệ thống dễ rơi vào tình trạng:

```
RBAC ✓
Audit ✓
Queue ✓
Idempotency ✓
Concurrency ✓
Report lifecycle ✓
Agent lifecycle ✓

nhưng

credential ?
foothold ?
attack path ?
pivot ?
privilege ?
target relation ?
exploit state ?
```

Với mục tiêu của bạn là **multi-host black-box AI red team**, ba abstraction quan trọng nhất tôi nghĩ schema nên có tiếp theo là:

```
Asset Graph
 +
Action / Intent → Execution → Evidence chain
 +
Access / Session / Credential state
```

Ba thứ này sẽ biến nền DB hiện tại từ một **AI-security workflow platform** thành core của một **autonomous red-team engine** thực sự.

 