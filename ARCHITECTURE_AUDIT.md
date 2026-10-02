Raptix có bằng chứng mạnh về bottleneck ở **harness/interface** hơn là bằng chứng cho thấy model thiếu khả năng reasoning. Ba vấn đề nổi bật nhất:

1. Failure/termination chưa trở thành control signal đáng tin cậy: exception được chuyển thành text; `[TERMINAL]` không thực sự kết thúc objective.
2. Foothold → Propagation chưa có boundary kiểm chứng bằng máy: exploit success, access được quản lý và capability dùng được chưa được nối bằng một contract load-bearing.
3. Planner propagation chưa nhìn thấy một current world state đủ dùng: KG summary vừa thiếu session/credential/reachability, vừa có lỗi refresh trong vòng tool → model.

Có một kết quả cần phân biệt rõ:

- Performance loss quan sát được rõ nhất trong dữ liệu hiện có nằm ở Initial Foothold/orchestration recovery.
- Architecture gap nghiêm trọng nhất cho full-flow nằm tại foothold boundary và Network Propagation.
- Chưa có dữ liệu propagation đủ tốt để khẳng định vùng thứ hai đang tiêu tốn nhiều thời gian/token nhất.

Tôi không sửa file hay chạy engagement mới trong audit này.

---

## Mục lục

- 1. Phạm vi và mức độ bằng chứng
- 2. Phase routing và phase boundary — A, C, D
- 3. Initial Foothold architecture — B, R
- 4. Propagation loop, planner input và graph load-bearing — E, F, G, H, I, J, S
- 5. StateDelta, fact/hypothesis và event history — K, L, M
- 6. Verification, failure taxonomy và retry — N, O, P
- 7. Multi-agent boundaries — Q
- 8. Observability — T
- 9. Bảng bottleneck ưu tiên
- 10. TOP 5 và experiment nhỏ nhất
- 11. Trả lời năm câu cuối
- Phụ lục — nội dung kèm theo trong file gốc

---

## 1. Phạm vi và mức độ bằng chứng

Audit trên working tree tại HEAD f41b6fa, bao gồm agent factories, prompts/workflows, middleware, OPPLAN, KGStore, graph utilities, session execution, verification và benchmark artifacts.

Ký hiệu:

- **S**: xác nhận từ implementation/wiring.
- **R**: quan sát trong artifact runtime đã có.
- **H**: tác động performance cần experiment kiểm chứng.

Để các code path ngắn nhưng vẫn chính xác:

- `R/` = packages/raptix/raptix/
- `C/` = packages/raptix-core/raptix_core/
- `D/` = .venv/lib/python3.13/site-packages/

### Runtime evidence đáng chú ý

Trong `workspace/t2-juice-b1/runs/A1/transcript.json`, tôi đếm lại trực tiếp:

| Quan sát | Kết quả |
|---|---|
| Parent AI messages | 224 |
| Model turns gọi `ls("/workspace/t2-A1/recon")` | 204 |
| Tỷ lệ parent AI messages có thao tác này | 91,1% |
| Kết quả trả về của 204 lần ls | Chỉ hai dạng, lặp 150 và 54 lần |
| Token tổng hợp của model turns phát ra các lần ls đó | 10.005.262 |
| Token tổng hợp toàn bộ parent transcript | 11.298.744 |
| `task()` results chứa recursion error thông thường | 6 |
| `task()` results chứa `[TERMINAL]` | 4 |
| Max input tokens của parent model call | 122.570 |

Đây là evidence của một no-information/recovery loop thật. Token ở trên là usage tổng hợp của các model calls, không phải unique context tokens hay USD; cũng không có nghĩa toàn bộ số token đó sẽ được tiết kiệm nếu bỏ polling.

Các điểm giới hạn quan trọng:

- A1 chạy image arm A; B1 chạy image arm B.
- A1/B1 khác shared prompt, RoE và ground-truth hash; denominator là 116 so với 7.
- Không thể dùng hai run này như một A/B hợp lệ.
- Các file `workspace/t2-A1/events.jsonl` và `t2-B1/events.jsonl` tích lũy nhiều lượt; không dùng tổng của chúng như số liệu một run.
- `benchmark/juice_shop_t2.py:530–540` tính `token_count` từ parent messages. Specialist token cost chưa được cộng đầy đủ vào con số này.
- Các file control quan trọng tôi đối chiếu—`subagent_streaming.py`, `opplan.py`, `kg.py`, orchestrator prompt, `skillogy.py`—không có diff giữa arm A commit và HEAD. Tuy nhiên điều đó chưa chứng minh toàn bộ runtime image giống working tree hiện tại.

## 2. Phase routing và phase boundary — A, C, D

### 2.1 Ai thực sự điều khiển phase?

| Câu hỏi | Implementation thực tế |
|---|---|
| Phase được biểu diễn ở đâu? | `C/types/engagement.py:37–52`: `ObjectivePhase` gồm recon, initial-access, post-exploit, c2, exfiltration. |
| Có current_phase cấp engagement không? | Không thấy trong các state schema của đường orchestrator chuẩn. Phase nằm trên từng objective. |
| Ai chọn specialist? | Orchestrator LLM chọn `task(description, subagent_type)` theo prompt, catalog và OPPLAN. |
| Routing code path | `R/agents/standard/decepticon.py:145–153` → `R/agents/middleware_slots.py:_make_subagent()` → `D/deepagents/middleware/subagents.py:_build_task_tool()`. |
| Ai quyết định objective hoàn thành? | LLM gọi `update_objective(status="completed")`. |
| Controller kiểm tra gì? | Status transition, blocked_by khi chuyển in-progress, child completion khi hoàn thành parent. |
| Controller có kiểm tra verified foothold/session/capability không? | Không thấy. |
| Khi nào chuyển phase? | Khi LLM chọn objective/specialist tiếp theo. Không có engagement phase-transition controller riêng. |

`R/tools/opplan.py:652–741` thực hiện validation trạng thái và dependency, nhưng không đọc acceptance criteria để kiểm chứng completion, không bắt buộc evidence tồn tại, không kiểm tra session còn sống.

Một điểm đáng chú ý: orchestrator prompt nói middleware chặn exploit trước recon và một số trường hợp blocking sau recon observations. Các check tương ứng không xuất hiện trong OPPLANMiddleware/`update_objective()` được audit. Những câu này đang là prompt policy, không phải controller implementation.

Ngoài ra:

- `task()` không bắt buộc objective_id.
- Dispatch không được nối bắt buộc với transition OPPLAN.
- Vì vậy validation khi gọi `update_objective()` không phải một execution gate chung cho mọi dispatch.
- Recommendation "Next" trong `R/middleware/opplan.py:227–229` chọn theo status/priority, chưa lọc dependency hay capability preconditions.

### 2.2 Mapping sang ba vùng của audit

| Vùng audit | Mapping hiện tại | Boundary thực tế |
|---|---|---|
| Initial Foothold | recon, initial-access; recon/exploit/surface_exploit và domain specialists | Observations, coverage-cell outcome, findings và objective status |
| Network Propagation | Chủ yếu post-exploit, c2; postexploit/ad_operator/cloud_hunter | Natural-language handoff, workspace inventory, graph observations tùy role |
| Action on Objectives | Chủ yếu exfiltration, hoặc objective goal-specific | Acceptance criteria và evidence trong prompt/files |

Đây không phải một abstraction/control style hoàn toàn đồng nhất. Initial Foothold đã có coverage matrix/cell workflow riêng. Nhưng sự khác biệt hiện đi theo hướng:

> Initial Foothold được phân rã và điều phối khá chi tiết; propagation lại được giao cho worker một vòng nhiều bước rất rộng.

Đó là bất đối xứng cần đo, không phải lý do để thống nhất toàn bộ kill chain.

### 2.3 Foothold artifact hiện có đến đâu?

Không phải Raptix chỉ có text finding. Nó có structured operational files và graph vocabulary liên quan access. Nhưng chưa thấy một foothold artifact được controller tiêu thụ và kiểm chứng như boundary bắt buộc.

| Semantic cần có | Representation hiện có | Khoảng trống |
|---|---|---|
| Asset | Host nodes; IP/hostname trong shells.json theo prompt | Không bắt buộc cùng identity với session |
| Access/session identifier | Shell inventory; implant ID trong verification workflow | Không có registry contract chung được enforcement |
| Access type | Shell/implant/credential trong exploit prompt | Không tách rõ access bằng credential với execution |
| Principal/account | Credentials, user/access summary | Không có binding bắt buộc asset–principal–session |
| Privilege | user/admin/SYSTEM/root theo prompt | Không có verified privilege field bắt buộc |
| Execution capability | Proof-of-access/code execution trong findings | Không thành capability precondition của planner |
| Interfaces/network position | ip a/ipconfig evidence theo postexploit workflow | Không tự chuyển thành graph reachability |
| Observed/reachable networks | network_map.json, adjacent leads | Không phân biệt nhìn thấy với thực sự đi tới được |
| Usable credentials | Credential nodes/files | Không có common validity/expiry contract |
| Session status | Callback/last-checkin theo workflow | Không có automated invalidation loop |
| Evidence/verification | Finding files và evidence artifacts | Chủ yếu worker tạo và LLM diễn giải |

Code/prompt liên quan:

- `R/agents/prompts/standard/exploit.md:175–195`
- `R/agents/prompts/workflows/postexploit.md:19–45`
- `C/types/kg.py`: Session, Credential, HAS_SESSION, CAN_ACCESS, ADMIN_TO

**Exploit success có tách khỏi managed foothold không?**

Tách trong ngôn ngữ một phần, chưa tách bằng control contract.

Exploit success hiện bao gồm nhiều loại kết quả:

- credential captured;
- data extraction;
- RCE confirmed;
- initial access.

Những kết quả này không tương đương nhau về propagation capability. Trong khi đó, workload trigger ở orchestrator prompt gộp "initial RCE / cred dump / sandbox shell" vào thời điểm "after foothold".

Không thấy controller bắt buộc chuỗi:

```text
Exploit result
→ verify access
→ bind managed session/access reference
→ verify execution/privilege/reachability
→ permit propagation objective
```

**Candidate bottleneck được xác nhận: completion status có thể được dùng thay cho capability thật.**

Không thấy một pipeline tự động literal PASSED → capability added. Đường thực tế là:

```text
worker return / artifact
→ orchestrator LLM diễn giải
→ update_objective(completed)
→ LLM chọn propagation task
```

Vấn đề là đường này có thể tiến tiếp mà thiếu access verification, chứ không phải mọi PASSED đều tự động ghi một capability node.

### 2.4 C2/session boundary

**Những phần đã có**

- Orchestrator độc quyền ops_start/stop/status/cleanup.
- Daemon quản lý workload lifecycle.
- OpsControlNotificationMiddleware đưa readiness transition vào context.
- Specialist thao tác Sliver qua bash/interactive console.
- Postexploit workflow yêu cầu implant ID, callback time và last-checkin.

Paths:

- `R/agents/standard/decepticon.py:155–174`
- `R/tools/ops/tools.py`
- `R/agents/prompts/standard/decepticon.md:100–123`
- `R/skills/defs/standard/post-exploit/c2-sliver/SKILL.md`

**Boundary còn thiếu**

Workload readiness không phải target-session liveness.

"Sliver container running" hoặc kết nối được tới team server không chứng minh:

- host còn có implant;
- session handle dùng được;
- principal/privilege đúng;
- tunnel/route còn hoạt động.

Không thấy lifecycle event của target session được nối tới:

- asset graph;
- capability invalidation;
- dependent path invalidation.

`TmuxSessionManager` có deterministic session recovery, nhưng đó là sandbox terminal session, không phải remote foothold/session.

Planner hiện ít trực tiếp làm shell mechanics; đó là điểm tốt. Tuy nhiên nó vẫn phải truyền config path, suy ra workload readiness và diễn giải session inventory qua narrative. Semantic bookkeeping chưa được tách sạch khỏi các mechanics đó.

## 3. Initial Foothold architecture — B, R

### 3.1 Objective contract và autonomy

**Generic exploit**

Handoff theo orchestrator prompt bao gồm:

- workspace;
- observations và evidence excerpts;
- target URL/parameters;
- captured tokens;
- prior findings/lessons;
- cited sub-skill;
- scope, acceptance criteria và OPSEC context.

Đây không chỉ là target/objective/RoE, nhưng phần lớn thông tin bổ sung hữu ích cho local exploitation. Không có evidence đủ mạnh để gọi toàn bộ handoff này là strategic-context pollution.

Exploit worker có vòng local observe → hypothesize → interact → adapt. Nó không phải quay về orchestrator sau mỗi command.

**Surface exploit**

Contract hẹp hơn nhiều:

```text
one vulnerability class
× one normalized surface
× one assigned session
```

Worker bị cấm đổi class/surface, phải trả open_proof_gap nếu chưa chứng minh được.

Paths:

- `R/agents/prompts/standard/surface_exploit.md:10–26`
- `R/agents/standard/_surface_dispatch.py:44–72`
- `R/agents/prompts/standard/decepticon.md:46–50`

Đây là candidate over-control tại boundary giữa các cell, không phải micromanagement từng payload.

Khả năng bất lợi **H**: khi một hypothesis cần chuyển endpoint/class để kiểm chứng, reasoning phải đi qua worker return → OPPLAN accounting → re-expansion → dispatch mới.

Nhưng coverage cells cũng giúp isolation, evidence và bounded fan-out. Chưa có ablation đủ sạch để kết luận cell abstraction đang làm giảm success.

### 3.2 Contract inconsistency có evidence mạnh hơn "bash quá rộng"

Có nhiều instruction không khớp tool/context surface thực tế:

1. Orchestrator được yêu cầu load exploit router, nhưng default skill sources của role decepticon chỉ là own-role tree + shared + benchmark.
   - Prompt: `standard/decepticon.md:58–65`
   - Sources: `middleware_slots.py:89–109`
   - ACL enforcement: `skills/engine/server/neo4j_backend.py:249–252`
2. Startup/final-report path dùng `/standard/raptix/`, trong packaged tree là `/standard/decepticon/`.
   - Runtime B1 ghi nhận no Skill at path .../raptix/engagement-startup/SKILL.md.
   - Tool result vẫn có `status="success"`.
3. Exploit workflow yêu cầu "Confirmed sinks" và handoff sections, trong khi recon identity yêu cầu observation-only, không classification.
   - `prompts/workflows/exploit.md:19–23`
   - `prompts/standard/recon.md:6–10, 37`
4. Exploit được hướng dẫn add_objective/update_objective, nhưng factory/slots không cho role này OPPLAN tools.
   - `standard/exploit.md:163, 194`
   - `workflows/exploit.md:111`
   - `C/contracts/slots.py:205`
5. postexploit fallback skill source dùng tên role postexploit, trong khi packaged skills và cited paths dùng post-exploit.

Information/control problem: worker và planner phải giải quyết sự mâu thuẫn của harness trước khi giải quyết target. Đây là evidence trực tiếp cho interface friction; chưa cần giả định model reasoning yếu.

### 3.3 Tool surface của exploitation agents

| Loại | exploit | surface_exploit |
|---|---|---|
| Generic execution | bash, bash_output, bash_kill, bash_status | Cùng bộ |
| HTTP/API interaction | Chủ yếu qua shell | http_request, http_history; proxy send/view/repeat/sitemap |
| Semantic/domain | Không có execution-domain API riêng trong baseline | JWT parse/forge/crack, GraphQL plan, OAuth/cookie audit |
| Retrieval/knowledge | CVE lookup, PoC lookup, payload search, methodology lookup; skill tools | Cùng bộ, thêm web search/fetch |
| State/KG | Filesystem; optional scanner auto-ingest | Filesystem, kg_record, kg_ingest, summary; optional auto-ingest |
| Structured return enforcement | Không thấy response_format | JSON response template trong prompt, chưa schema-enforced |

Nguồn: `standard/exploit.py:77–88`, `standard/surface_exploit.py:24–35`, `tools/web/tools.py:248–260`.

**Những metric đo được/chưa đo được**

| Metric | Kết quả audit |
|---|---|
| Repeated no-information calls | Có: 204 directory inspections trong parent A1 |
| Orchestrator can thiệp mechanics | Có filesystem/recovery work; chưa đủ trace để phân loại mọi lần can thiệp |
| Syntax/tool-argument failure rate của exploit | Chưa đo được tin cậy |
| Command repair count | Chưa đo được |
| Repeated low-level exploit sequences | Chưa có child trace đủ đầy cho run đã archive |
| Semantic tools tốt hơn bash? | Chưa chứng minh |

Không có cơ sở để đề xuất thay broad bash bằng semantic tool suite ở giai đoạn này.

## 4. Propagation loop, planner input và graph load-bearing — E, F, G, H, I, J, S

### 4.1 Loop thực tế

```text
Orchestrator LLM
  → OPPLAN status + cached KG summary + own conversation
  → chọn objective và natural-language task
  → specialist local loop
  → files / optional KG writes
  → last non-empty AI text returned as task result
  → orchestrator LLM đánh giá
  → OPPLAN update
  → quyết định tiếp
```

So với loop kỳ vọng:

| Boundary | Hiện trạng |
|---|---|
| Planner → current-state query | Có summary, nhưng thiếu operational state và refresh không đúng |
| Planner → semantic task | Chủ yếu natural-language description |
| Worker → evidence | Có files, findings, một số graph writes |
| Evidence → verification | Có quy trình trong prompt; verifier riêng chỉ ở research lane |
| Verification → state update | Không có common propagation promotion gate |
| State update → next planner context | Có thể stale hoặc chỉ phản ánh status/narrative |

postexploit prompt giao worker toàn bộ credential → privesc → lateral → discovery → repeat, đồng thời yêu cầu ưu tiên high-value target.

**Under-control candidate:** worker không chỉ quyết HOW của một task; nó còn có thể quyết nhiều capability transitions và thứ tự multi-host trong một dispatch.

### 4.2 Context thực tế theo phase

| Vai trò | Context nhận thực tế | Thiếu / leakage đáng chú ý |
|---|---|---|
| Exploit specialist | Own identity + always-loaded workflow + bash guidance + scoped task + local history + skills + engagement metadata | Layered instructions mâu thuẫn; discovery có thể lặp recon |
| Propagation planner | Engagement context, toàn bộ OPPLAN tracker, own accumulated messages/task returns, skill policy/MoC, cached KG summary; files đọc on demand | Không có verified foothold/session/credential/reachable-segment slice |
| Propagation worker | Natural-language task, own workflow, local history, engagement metadata, files đọc on demand | Source session/capability và evidence contract không bắt buộc; postexploit không có KGMiddleware |
| Objective worker | Dùng postexploit/domain worker với objective/constraints truyền qua task | Không có objective-specific verification contract chung; dễ tiếp tục broad post-exploit loop |

**Những gì planner propagation thực sự thấy**

| Thành phần | Có tự động vào context? |
|---|---|
| Engagement objective | Qua OPPLAN/CONOPS đã đọc |
| Relevant hosts | Không có host slice tự động |
| Managed sessions | Không |
| Credentials | Không |
| Reachable segments | Không |
| Attack paths | Chỉ crown-jewel path count, không hop/path proposal |
| Operational capabilities | Không có projection trực tiếp |
| Recent failures | Task returns/history; optional tried-edge ledger |
| Raw tool output | Output từ filesystem/KG inventory mà planner gọi |
| Conversation history | Own history, được summarization khi cần |
| OPPLAN | Static instructions + live status mỗi call |
| Skills | Skillogy policy/MoC mặc định; body đọc on demand |

Planner hiện thiên về accumulated narrative + task status hơn là current operational world state.

**Không có whole-parent-history injection vào child**

Tôi kiểm tra dependency đang cài và khóa ở DeepAgents 0.6.8:

- `D/deepagents/middleware/subagents.py:534–540` thay child messages bằng một `HumanMessage(description)`.
- Parent messages nằm trong excluded keys.
- Các non-excluded state fields vẫn được truyền; child graph chỉ sử dụng các channel nó khai báo.

Vì vậy không flag lỗi "toàn bộ parent transcript được copy vào child".

`R/agents/task_spec.py` định nghĩa scoped TaskSpec tốt hơn, nhưng module tự ghi rõ chưa integrated; search call sites xác nhận không nối vào main dispatch. `R/runtime/task_spec.py` là contract CART replay, không phải main propagation handoff.

### 4.3 Lỗi freshness được xác nhận

`R/middleware/kg.py`:

- hydrate summary trong before_agent;
- `wrap_model_call` chỉ inject cached kg_summary;
- after_model có thể đặt revision thành "dirty".

Nhưng LangChain factory:

- `D/langchain/agents/factory.py:1566–1579`: before_agent chạy ở entry;
- tool loop quay về before_model/model, không quay lại before_agent.

**Hệ quả S:** Graph update trong cùng một invocation không đảm bảo xuất hiện trong summary của planner turn kế tiếp.

Còn hai vấn đề bổ sung:

- `KGStore.revision()` dùng max node lastupdated, chuyển thành integer seconds.
- Edge-only mutation hoặc nhiều writes trong cùng giây có thể không tạo revision mới đủ phân biệt.

Paths: `kg_internal/store.py:228–238, 344`.

Đây là lỗi interface/state freshness, không phải lỗi model reconstruct state.

### 4.4 Capability representation: có vocabulary, chưa thành planning contract

Raptix có:

- Credential, Session, User, Network;
- AUTHENTICATES_TO, HAS_SESSION, CAN_ACCESS, ADMIN_TO, ROUTES_TO, PIVOTS_TO, ENABLES.

Nhưng không thấy:

- verified usable capability projection;
- source session binding;
- validity/expiry chung;
- prerequisites/effects mà planner dùng bắt buộc.

Đặc biệt, HAS_SESSION từ BloodHound là computer → user logon relationship, không phải Sliver access handle của Raptix.

Paths:

- `C/types/kg.py`
- `R/tools/ad/bloodhound.py:482–515`

Nếu đọc mọi HAS_SESSION như "ta có usable execution session", đó là sai abstraction. Audit chưa quan sát được một run thực sự mắc lỗi này, nhưng vocabulary hiện không tự ngăn nó.

### 4.5 Attack graph có load-bearing không?

**Có load-bearing ở Initial Foothold inventory**

`kg_surface_inventory`:

1. query Endpoint/children;
2. normalize surfaces;
3. build coverage cells;
4. trả objective_children.

Path: `R/middleware/kg_internal/tools.py:190–235`.

Đây là graph-derived input thực sự cho coverage planning.

**Chưa thấy load-bearing propagation chain planning trong baseline**

Có graph algorithms:

- `plan_chains()`: APOC Dijkstra, fallback shortestPath;
- `critical_path_score()`;
- `impact_analysis()`;
- `credential_reachability()`;
- `plan_attack_chains()` và `suggest_objectives_from_chains()` wrappers.

Nhưng:

- orchestrator chỉ được expose kg_surface_inventory;
- postexploit không có graph query tools;
- analyst baseline không expose chain planner;
- ad_operator dùng BHCE/manual path analysis, generic chain planner được park;
- exploiter factory không có full research bundle dù docstring còn nói có.

**Graph feature tồn tại ≠ propagation planner đang dùng graph.**

Summary hiện query:

- node/edge counts;
- tối đa 5 vulnerabilities;
- tối đa 3 entrypoints;
- crown jewels và path counts.

Nó không query session, credential, privilege hay reachability. "Viable paths" được đếm qua quan hệ bất kỳ [*1..6], chưa lọc verification/precondition/liveness.

Paths:

- `R/middleware/kg_internal/summary.py:61–133`
- `R/agents/middleware_slots.py:229`
- `R/agents/standard/ad_operator.py:56–77`
- `R/tools/research/chain.py`

Typical propagation query frequency / path-follow rate: chưa xác định được từ artifacts hiện có. Không có đủ archived multi-host run để trả một con số đáng tin.

Experiment "with vs without graph planning" chỉ có ý nghĩa sau khi xác nhận baseline thực sự gọi graph planner. Hiện tại phải phân biệt:

- bỏ KG summary;
- bỏ surface inventory;
- bỏ BHCE path analysis;

đó là ba ablation khác nhau.

### 4.6 Planner → worker và worker → planner contracts

**Planner → worker**

Main dispatch schema chỉ có:

```text
description: str
subagent_type: str
```

WHAT, WHY, target, constraints, acceptance criteria được yêu cầu bằng prompt. Nhưng:

- source session/capability không bắt buộc;
- expected evidence không schema-enforced;
- objective identity không bắt buộc;
- state revision/preconditions không có.

Worker vẫn có quyền HOW rộng, trừ surface cell lock.

**Worker → planner**

Không chính xác nếu nói tất cả worker chỉ trả PASSED/BLOCKED.

Có richer formats:

- exploit: success/convergence/pivot/exit-report artifacts;
- surface_exploit: confirmed/ruled_out/open_proof_gap JSON template;
- domain agents: partial/blocked và domain-specific fields.

Tuy nhiên main factory không cấu hình response_format; main handoff vẫn thường là last non-empty AI text.

Path: `D/deepagents/middleware/subagents.py:494–531`.

Không có common enforced:

- StateDelta;
- acquired/invalidated capabilities;
- uncertainty;
- typed failure;
- partial valid state reference;
- verification result.

Thông tin không nhất thiết mất khỏi disk, nhưng bị mất khỏi decision interface. Planner phải đọc lại, tìm và diễn giải artifacts.

## 5. StateDelta, fact/hypothesis và event history — K, L, M

### 5.1 Các persistence paths chính

| Path | Semantics |
|---|---|
| OPPLAN tools → LangGraph state + plan/opplan.json | Status/objective tracking |
| Filesystem tools / bash writes | Findings, creds, shells, network map, local attempts |
| `kg_record` → `KGStore.record_observations()` | Atomic batch node/edge upsert |
| kg_ingest / auto-ingest | Scanner output → observations → KGStore |
| Legacy `_load/_save`/graph_transaction | Whole-graph read/modify/upsert qua compat shim |
| BloodHound canonical ingest | AD topology vào KGStore |
| BHCE tools | Upload/query graph riêng của BHCE |
| PoC validation | Validation props + Finding/VALIDATES edges |
| EventLog / subagent transcripts | Execution history, không phải current world state |

**StateDelta**

`record_observations()` có semantic tương đương nodes/edges added-or-updated, nhưng không phải full StateDelta:

- không phân biệt rõ add/update trong payload;
- không có capability removal;
- không có common edge invalidation;
- không có task-level hypotheses/evidence schema;
- không có causal transition envelope.

**Transactions và conflict**

Điểm tốt:

- Một `kg_record` batch là atomic.
- Neo4j driver retry deadlock.
- Deterministic keys hỗ trợ dedup.

Khoảng trống:

- `SET n += row.props`: conflicting value mới thắng; không semantic conflict resolution.
- created_by và source_episode_id bị overwrite trên lần touch mới.
- Legacy `_save()` lưu toàn bộ nodes rồi từng edge riêng; không atomic toàn state transition.
- `_GRAPH_LOCK` chỉ bảo vệ một process.
- OPPLAN persistence best-effort; state/file có thể tạm diverge.
- File inventories không có transaction chung với KG và task return.

Failed task có thể để lại partial valid files/KG/target effects. Điều đó bình thường, nhưng return interface chưa mô tả partial state một cách máy đọc được.

### 5.2 Fact vs hypothesis

| Thuộc tính | Có bắt buộc trên canonical observation không? |
|---|---|
| Agent/tool provenance | Có, nhưng có fallback "agent"/"legacy" |
| Timestamp | Có firstseen/lastupdated |
| Evidence reference/hash | Không |
| Confidence | Không |
| Verification status | Không |
| Expiry/stale status | Không |
| Fact/hypothesis classification | Có Hypothesis node kind, nhưng không bắt buộc phân loại đúng |

Ví dụ epistemic contamination đáng chú ý:

```text
Nuclei scanner match
→ Vulnerability node + HAS_VULN
→ summary hiển thị "Top vulnerabilities"
→ path count gọi là "viable"
```

`_adapt_nuclei_jsonl()` không bắt buộc validated=false/confidence/evidence reference; summary không filter verification.

Paths:

- `R/middleware/kg_internal/ingest.py:270–345`
- `R/middleware/kg_internal/summary.py:83–133`
- `R/middleware/kg_internal/store.py:311–499`

`kg_record` cũng cho agent ghi arbitrary props/kind label hợp lệ về syntax, không kiểm tra bằng chứng semantic.

**Risk xác nhận từ code:** observation/candidate có thể được tiêu thụ như actionable fact. Chưa có runtime evidence đủ để đo false-capability rate.

**Raw exploitation history có pollute global state không?**

Thiết kế prompt hiện yêu cầu raw HTML/JSON ở artifact, không dump vào KG. Auto-ingest cũng bounded và chỉ nhận scanner formats cụ thể. Không có evidence để kết luận KG hiện bị raw exploitation history flood diện rộng.

Ngược lại, execution capability quan trọng có thể chỉ ở conversation/files, đặc biệt exploit/postexploit không có normal KG write surface; scanner auto-ingest không bù được session/privilege state.

### 5.3 Current state và history chưa nối đủ

- KG là mutable current-ish store, nhưng append-mostly và không có common validity window.
- `delete_stale()` có helper, không thấy runtime caller.
- EventLog append-only, có locking và fsync; không phải tamper-evident immutable ledger.
- source_episode_id có thể trace tới tool call, nhưng latest-write provenance không giữ toàn history.
- Chưa có complete state-transition event stream.

Một lỗi phục vụ measurement/replay riêng:

`KGStore.snapshot()` đọc props_json, trong khi canonical writes ghi properties trực tiếp. Vì vậy snapshot có thể giữ topology nhưng mất property changes.

Paths: `store.py:240–307` so với `435–484`.

## 6. Verification, failure taxonomy và retry — N, O, P

### 6.1 Ai xác nhận các critical transitions?

| Transition | Cơ chế chính hiện tại | Phân loại |
|---|---|---|
| Credential usable | Worker thử auth, ghi evidence; một số secret validators có deterministic probe | Worker + tool evidence; không common gate |
| Session established | Worker capture callback/implant ID/last-checkin | Worker self-report dựa output |
| Privilege gained | Worker proof-of-access | Worker + evidence |
| Host accessible | Tool response được worker diễn giải | Worker + evidence |
| Segment reachable | Worker discovery/network map | Worker; không required reachability verifier |
| Lateral hop succeeded | Worker report + findings | Worker; planner LLM review |
| Objective completed | LLM gọi OPPLAN update | LLM decision; controller chỉ validate status/dependencies |
| Research finding validated | validate_workspace_finding/validate_poc | Deterministic matching; predicates do worker chọn |

Verification có tồn tại; vấn đề là nó chưa load-bearing trên mọi propagation transition.

`validate_workspace_finding` yêu cầu positive và baseline controls. Nhưng nó nằm ở plugin verifier lane, không phải prerequisite của postexploit.

Legacy `validate_poc()` vẫn có thể validate khi không chạy negative control; graph promotion không tự chứng minh managed access.

### 6.2 Failure taxonomy hiện có

| Nhóm audit | Representation hiện tại | Boundary mất thông tin |
|---|---|---|
| PLANNING: wrong priority, irrelevant action, missing precondition | Narrative, OPPLAN dependency errors, wandering heuristic | Không typed strategic reason |
| TOOL: invalid args, wrong tool, unavailable skill | Validation text/JSON errors | Nhiều lỗi business trả tool status success |
| EXECUTION: timeout, unavailable resource | Exception text, [TIMEOUT], ops error envelopes | Planner phải string-match để quyết retry |
| STATE: stale/missing/contradictory fact | Tool errors hoặc không phát hiện | Không contradiction/freshness contract chung |
| CONTROL: retry loop, premature stop, budget exhaustion | Recursion error, [TERMINAL], BudgetExceeded | Terminal text chưa enforce termination |

Paths:

- `R/agents/prompts/standard/decepticon.md:77–87`
- `R/core/subagent_streaming.py:131–139, 216–228, 653–673`
- `R/middleware/tried_edges.py`
- `R/middleware/budget.py`

Tried-edge ledger là điểm tiến bộ, nhưng:

- opt-in mặc định off;
- exit_zero được ghi là success, chưa phải capability success;
- target lấy từ engagement target_value, chưa chắc là actual lateral destination;
- không biểu diễn các failure classes ở bảng trên.

### 6.3 Retry responsibility

| Lớp | Hiện trạng |
|---|---|
| Deterministic runtime | Có tmux recovery, Neo4j transient retry, model fallback, API retry |
| Worker | Có local hypothesis/payload rotation và fail-fast rules trong prompt |
| Planner | Được yêu cầu retry cùng subagent khi infra/empty return; reclassify/switch path khi wandering |

**Flag:** planner đang nhận trách nhiệm low-level infra retries bằng prompt/string matching.

**Flag:** postexploit có thể đi nhiều chiến lược/hops trước khi trả; planner không nhận structured intermediate strategic-failure state.

**Flag mạnh nhất:** `_consecutive_failures` nằm trên runnable instance/role, không trên objective identity. Một role có thể nhận nhiều objectives và parallel calls. `[TERMINAL]` chỉ thay nội dung error; invocation sau vẫn chạy.

A1 có terminal messages rồi tiếp tục dispatch/failure. Đây là runtime evidence, không chỉ hypothetical loop.

## 7. Multi-agent boundaries — Q

Các success criteria dưới đây chủ yếu là prompt contracts, không schema-enforced.

Ký hiệu state:

- **W**: engagement workspace.
- **K**: KGMiddleware summary + record/ingest.
- **L**: legacy KG tools.
- **A**: scanner auto-ingest opt-in.
- **BH**: BHCE graph.
- **O**: OPPLAN.

| Agent | Phase | Unique context | Unique tools | Unique policy | Unique state access | Unique success criteria |
|---|---|---|---|---|---|---|
| decepticon/raptix | Cả flow | Engagement, objectives, handoffs | task, OPPLAN, ops, surface inventory | Không trực tiếp offensive execution | W/O/K | Objective accounting, report |
| soundwave | Planning | Operator interview | ask_user_question, complete_planning | Document-only | W | Engagement bundle |
| autohunt | Planning | Trusted single-target bootstrap | Reuse soundwave | Autonomous bootstrap | W | Planning bundle |
| recon | IF; discovery | Target observations | oneliners, killchain, search/fetch, bash | Observation-only, return triggers | W/K/A | Surface inventory + SUMMARY |
| osint_operator | IF | Public footprint | Search/fetch, L, references, bash | Passive; không authenticate target | W/K/L | Public leads |
| exploit | IF | Recon evidence/local hypothesis | CVE/PoC/payload/methodology, bash | Adaptive local exploitation | W/A | Proven access/impact hoặc exit artifact |
| surface_exploit | IF | One class × surface × session | Web/proxy + references + bash | Cell lock, bounded proof | W/K/A | confirmed/ruled_out/proof-gap |
| postexploit | NP/AO | Foothold, host/credential inventory | killchain, bash | Fail-fast, access expansion | W/A | New cred/privilege/hop hoặc exit |
| ad_operator | IF/NP | AD identities/ACL/paths | AD/BHCE, bash | Explicit DC/replication authorization | W/K/BH/A | Confirmed domain access/path |
| cloud_hunter | IF/NP/AO | IAM/cloud/resource state | CLOUD_TOOLS, CVE, bash | Cloud scope/OPSEC | W/A | Cloud finding/access |
| analyst | Research/reporting | Source/CVE/findings | Reporting, references, search/fetch, bash | Evidence-grounded analysis | W/K | Analysis/report |
| reverser | Research | Binary internals | REVERSING_TOOLS, bash | Binary-analysis scope | W | Analysis/primitive |
| contract_auditor | Research/objective | EVM/contract context | CONTRACT_TOOLS, bash | Contract scope/proof | W/K | Confirmed contract finding |
| phisher | IF | Lure/campaign context | References, search/fetch, bash | Lure deconfliction | W | Authorized campaign result |
| mobile_operator | IF/research | App/device/session | CVE/payload/methodology, bash | Mobile target scope | W | Reproducible app finding |
| wireless_operator | IF | RF/hardware context | Methodology, bash | Authorized radio/hardware scope | W | Wireless evidence |
| iot_operator | IF/research | Firmware/device | L + references + bash | Device/firmware scope | W/L | Device finding |
| ics_operator | IF/NP/AO | Protocol + process context | L + references + bash | Read-only first; lab/canary write gate | W/L | Authorized bounded proof |
| forensicator | Cross-cutting | Evidence/timeline/IOCs | L + references + bash | DFIR/purple validation | W/L | Timeline/detection evidence |
| supply_chain_operator | IF/research | Dependencies/CI context | L + references + bash | Authorized supply-chain scope | W/L | Supply-chain finding |
| blue_cell | Cross-cutting | Red activity/detection rules | Scan/brief/navigator + KG reads | Không bash; matcher decides detection | W/L | Detection gaps/coverage |
| vulnresearch | Research | Stage/batch status | task + OPPLAN | Stage ordering | W/O | Research stage ledger |
| scanner | Research | Source shards | SCANNER_TOOLS, bash | Deterministic candidate prefilter | W; candidate writes | Ranked candidates |
| detector | Research | Candidate/source context | CVE/OSV | Không bash | W | Promote/reject analysis |
| verifier | Research | PoC + controls | Workspace verifier, bash | Positive + baseline proof | W | Verified finding |
| patcher | Remediation | Verified bug/source | Bash + filesystem | Minimal patch/proof | W | Fix evidence |
| exploiter | Research/IF | Verified primitive/chain | CVE/PoC/payload, bash | One chain objective | W | Exploit artifact |

**Merge/coordination candidates**

- Exploit vs exploiter: tool surface gần nhau, nhưng input boundary khác—black-box foothold so với validated research primitive. Candidate ablation, chưa đủ lý do merge.
- Recon → exploit classification handoff: có thông tin hữu ích cần giữ, nhưng ownership/skill ACL hiện mâu thuẫn. Có thể ablate reduced coordination cho local classification.
- Surface-cell split: ablate fixed-cell dispatch so với một adaptive local objective cùng scope.
- IoT/ICS/DFIR/supply-chain: tool lists gần như giống nhau, nhưng unique policy và context có ý nghĩa. Không thể kết luận "không mất boundary".
- OSINT vs recon: passive/active policy là boundary thật; không phải agent split thừa chỉ vì cùng có bash.

## 8. Observability — T

| Cần reconstruct | Hiện có | Thiếu |
|---|---|---|
| Run/phase | Engagement events, OPPLAN phase/status, LangSmith khi bật | Không explicit active phase span |
| Planner context | Checkpoint/history; optional model recording | Không guaranteed state slice/revision refs mỗi decision |
| Chosen task | Parent task call | Natural-language payload |
| Worker execution | LangSmith; custom subagent events | Default event log chưa đủ correlate parallel invocations |
| Tool calls/results | EventLog counts/status/length; durable transcript | EventLog không giữ command/content; args thực tế trong sample {} |
| State update | KG provenance + OPPLAN tools | Không canonical StateDelta span |
| Verification | PoC records/files | Không propagation verification span chung |
| Cost/tokens | Usage + LiteLLM | Benchmark parent-only token aggregation |
| Final outcome | Objective statuses; benchmark oracle | Status completion không đồng nghĩa verified phase completion |

`StreamingRunnable` giữ durable events với invocation session_id; đây là điểm tốt. Tuy nhiên:

- start prompt bị cắt 200 ký tự;
- persisted tool result mặc định cap 8.000 ký tự;
- ID này là worker invocation, không phải target C2 session;
- archived T2 transcript chỉ giữ objectives/messages, bỏ subagent_transcripts.

`RecordingMiddleware` có thể lưu full model/tool requests, nhưng không nằm trong standard slot stack. Chưa thể giả định mọi run đều replay được. Serializer model response cũng cần kiểm chứng với wrapper ModelResponse trước khi dùng làm nền cho ablation.

**Metric có thể tính ngay**

- Parent/model/tool counts;
- repeated exact calls khi có full transcript;
- context-token trajectory;
- runtime failure frequency;
- wall time và objective status.

**Metric còn cần oracle/join tốt hơn**

- unnecessary actions;
- recovery rate theo failure class;
- routing accuracy;
- state extraction correctness;
- verification correctness;
- verified phase completion;
- path-follow rate và capability acquisition efficiency.

## 9. Bảng bottleneck ưu tiên

Priority dưới đây là ưu tiên kiểm chứng, không phải tuyên bố đã đo causal effect.

| Priority | Phase | Bottleneck | Exact code path | Evidence | Information/control problem | Expected effect [H] | Metric cần đo | Minimum experiment |
|---|---|---|---|---|---|---|---|---|
| P0–1 | Cross-cutting; observed IF | Runtime failure/terminal chỉ là text | R/core/subagent_streaming.py:216–228,653–673; orchestrator prompt §D | [S/R] Recursion errors, 4 terminal returns; 204 repeated directory inspections ở A1 | Model phải quyết recovery từ text; terminal không thành control outcome; counter không objective-scoped | Giảm dead-end redispatch/polling | Calls sau terminal, recovery rate, tokens tới next productive task | Cùng failure transcript: current text vs typed outcome + explicit terminal handling |
| P0–2 | NP | KG summary stale trong tool→model loop | R/middleware/kg.py:113–146,158–190,244–274; D/langchain/agents/factory.py:1566–1617 | [S] Hydrate ở before_agent; loop không chạy lại hook | Planner quyết trên snapshot cũ | Giảm missing/stale-precondition decisions | State age, stale decisions, recovery steps | Giữ nguyên summary format: cached-at-entry vs refresh trước decision |
| P0–3 | IF→NP | Completion không chứng minh usable foothold | R/tools/opplan.py:652–741; exploit handoff; postexploit intake | [S] Completed không bắt buộc verified session/capability/evidence | Exploit impact/task status có thể thay access precondition | Giảm false starts và capability assumptions | False-ready transitions, first-hop success | Self-report completion vs independent access check trên cùng recorded handoff |
| P1–4 | NP | Planner context bỏ session/credential/reachability; postexploit thiếu KG surface | R/middleware/kg_internal/summary.py; middleware_slots.py:229; C/contracts/slots.py:205–207 | [S] Queries không lấy operational access state | Capability phải reconstruct từ files/narrative | Tăng valid task selection/multi-hop continuity | Preconditions satisfied, valid hops/token, state reconstruction calls | Narrative vs constructed state context từ cùng facts |
| P1–5 | IF | Classification/handoff/skill contract mâu thuẫn | standard/decepticon.md:58–73; workflows/exploit.md:19–23; middleware_slots.py:89–109; skill ACL | [S/R] Router outside default ACL; startup path miss observed; missing OPPLAN tools | Reasoning bị dùng để reconcile harness thay target | Giảm tool-not-found/handoff bounce | Invalid skill calls, handoff retries, time-to-first-probe | Current layered contract vs consistent scoped handoff |
| P1–6 | NP | Worker có quyền strategic loop quá rộng | standard/postexploit.md:81–94; workflows/postexploit.md:28–36 | [S] Multi-host loop tới khi objectives đạt | Planner ít visibility giữa capability transitions | Giảm strategic wandering, tăng recovery | Hops/dispatch, strategic retry visibility | Full-loop task vs one capability-transition task |
| P1–7 | NP/cross-cutting | Scanner observation có thể thành actionable fact | kg_internal/ingest.py:270–345; summary.py:83–133; store.py:311–499 | [S] Verification/confidence không bắt buộc; summary gọi paths viable | Fact/hypothesis/usable capability bị trộn | Giảm epistemic contamination | False-fact promotion, invalid path selection | Cùng graph: current summary vs verification-qualified summary |
| P2–8 | IF | Fixed coverage cells có thể cắt local adaptive loop | surface_exploit.md:15–22; orchestrator matrix loop | [S] Không đổi class/surface; cần return/re-expansion | Local hypothesis transition thành coordination boundary | Có thể giảm overhead, cũng có thể giảm coverage | Success, coordination calls, repeated baselines | Fixed cells vs adaptive local objective, cùng scope/budget |
| P2–9 | NP | Chain planning không được main planner tiêu thụ | research/chain.py; research/tools.py:1677–1769; agent tool registries | [S] Algorithms tồn tại nhưng không expose vào baseline loop | Graph potential không chuyển thành task choice | Chưa xác định | Query frequency, path adoption, steps/success | Baseline vs same verified path candidates surfaced |
| P2–10 | Cross-cutting | State/event/replay measurement mất causal detail | runtime/event_log.py; middleware/event_logging.py; benchmark/juice_shop_t2.py:530–540,643–650 | [S/R] Parent-only tokens; exported child traces thiếu | Không phân biệt model/tool/control cost chính xác | Tăng độ tin cậy experiment | Trace completeness, total cost coverage | Reconcile một run: parent + child + LiteLLM + state revisions |
| P2–11 | State/replay | Snapshot property fidelity không khớp write schema | kg_internal/store.py:240–307,435–484 | [S] Snapshot đọc props_json; canonical write direct props | Property state transitions có thể biến mất khỏi diff | Tránh replay/ablation kết luận sai | Property-diff recall | Ghi hai state cùng topology khác privilege/status, so snapshot diff |

## 10. TOP 5 và experiment nhỏ nhất

### 1. Failure/termination không trở thành control signal

**Evidence mạnh nhất:** runtime A1 + current code.

**Experiment**

Dùng đúng một recorded failed dispatch và partial artifacts:

- A: error text hiện tại.
- B: cùng error/evidence, nhưng biểu diễn failure_kind, terminal_for_this_dispatch, partial_state_refs; không thay worker tool surface.

Nếu kiểm tra controller handling, giới hạn ở runtime termination của dispatch/objective, không biến tried-edge ledger thành path-pruning policy.

**Đo**

- redispatch cùng failure;
- calls không tạo information sau terminal;
- số calls/token tới quyết định có ích tiếp theo;
- có giữ partial valid state không.

**Falsification:** nếu B vẫn wandering tương đương, typed failure presentation đơn thuần không giải quyết control loop; cần tách model interpretation khỏi controller handling trong experiment kế tiếp.

### 2. KG freshness sai trong propagation loop

**Evidence:** deterministic lifecycle mismatch, không cần đổi model để tái hiện.

**Experiment**

Giữ nguyên query và summary format:

- A: hydrate ở invocation entry.
- B: refresh trước planner decision.

Fixture tối thiểu:

1. planner thấy graph revision X;
2. worker cập nhật một fact;
3. planner có decision kế tiếp trong cùng invocation.

Test thêm edge-only change và same-second writes riêng, để không trộn cache-lifecycle bug với revision-token bug.

**Đo**

- new fact visibility ngay decision tiếp theo;
- stale action rate;
- extra rediscovery calls;
- refresh latency.

Đây là experiment nhỏ nhất ở Network Propagation, vì không cần redesign graph/schema.

### 3. Foothold boundary dựa completion thay verified usable access

**Evidence:** OPPLAN validation và handoff wiring.

**Experiment**

Dùng các handoff có cùng success claim nhưng khác ground truth:

- RCE một lần, không managed session;
- credential sai hoặc chỉ valid cho web;
- session sống nhưng privilege hạn chế;
- session chết;
- access sống và execution/reachability đủ.

So:

- A: current self-report + finding review.
- B: cùng handoff nhưng transition chỉ được đánh giá ready sau independent access verification.

**Đo**

- false-ready rate;
- first propagation task success;
- retry/discovery lại access;
- verification overhead.

Không cần dựng một foothold schema lớn để làm experiment này.

### 4. Planner reason trên narrative thay operational state

**Evidence:** summary queries và missing access-state surface.

**Experiment**

Một propagation checkpoint có hai footholds, một credential usable, một route và một failed path:

- A: current narrative/history.
- B: current-state context xây từ đúng các facts đã biết: access, principal, privilege, execution, credential scope, reachability, verified failures.

Giữ objective, tools, model và budget như nhau. Để phân biệt "thêm facts" với "structure tốt hơn", có thể thêm một control nhỏ: cùng facts của B nhưng viết thành narrative.

**Đo**

- task có satisfied preconditions;
- lựa chọn source session;
- verified capability gains mỗi task;
- unnecessary graph/file rereads;
- model input tokens.

Không gộp refresh fix của experiment 2 vào đây.

### 5. Initial Foothold contract không nhất quán

**Evidence:** prompt/ACL/tool surface mismatch; runtime skill-load miss.

**Experiment**

Dùng một recon handoff đủ observations nhưng chưa có confirmed sink:

- A: layered contract hiện tại.
- B: một contract nhất quán về objective, observations, relevant artifacts, acceptance evidence và classification ownership.

Worker giữ HOW autonomy; cùng tools, cùng RoE/HITL/OPSEC constraints.

Chỉ resolve ownership/path/expected-section mismatch—không mở rộng tool permissions để "làm test chạy".

**Đo**

- invalid/unavailable skill/tool calls;
- handoff bounce;
- repeated discovery;
- time-to-first-target-specific probe;
- exploit success trong cùng budget.

Nếu lỗi mechanics chưa đáng kể sau khi contract nhất quán, không có lý do thêm semantic tool abstraction.

## 11. Trả lời năm câu cuối

**1. Raptix đang mất nhiều performance nhất ở phase nào?**

Theo evidence runtime hiện có: Initial Foothold, cụ thể orchestration/recovery sau specialist failure. A1 có 204 repeated directory inspections và nhiều recursion/terminal results.

Theo architecture risk cho full-flow: foothold → propagation và Network Propagation là vùng yếu nhất. Chưa có đủ measured propagation runs để nói vùng này mất nhiều performance nhất trên toàn hệ thống.

**2. Bottleneck đến từ model reasoning hay harness/interface?**

Evidence nghiêng về harness/interface.

Model có thể góp phần wandering, nhưng harness hiện:

- đưa terminal dưới dạng text;
- truyền những contract mâu thuẫn;
- cho planner state thiếu/stale;
- không nối completion với verified usable capability.

Chưa có model-swap ablation để quy phần residual failure cho reasoning capacity.

**3. Initial Foothold hiện có bị over-controlled không?**

Không over-controlled toàn bộ.

Generic exploit có local autonomous loop phù hợp. Candidate over-control nằm ở:

- classification ownership bị đẩy qua orchestrator dù knowledge access không khớp;
- fixed surface-cell lock cắt hypothesis chuyển class/endpoint;
- layered mandatory discovery/handoff rules có thể lặp hoặc mâu thuẫn.

Chưa chứng minh phải bỏ cell architecture hoặc merge agents.

**4. Network Propagation có bị under-controlled hoặc thiếu structured state không?**

Có, ở decision boundary.

Graph vocabulary và inventories tồn tại, nhưng thiếu đường load-bearing:

```text
verified access/capability
→ planner current-state context
→ task with source/preconditions
→ verified outcome
→ updated current state
```

Đồng thời postexploit được quyền chạy một strategic multi-host loop rộng mà planner không có structured intermediate visibility.

**5. Một thay đổi architecture nhỏ nhất có khả năng tạo measurable improvement lớn nhất?**

Với loss đã quan sát: làm runtime failure/terminal handoff thành một outcome được xử lý rõ ở dispatch boundary, thay vì chỉ text cho LLM tự diễn giải. Experiment này nhắm trực tiếp vào no-information/recovery loop đã thấy.

Nếu chỉ xét Network Propagation: thay đổi nhỏ nhất là refresh đúng current KG summary trước planner decision; giữ nguyên format để đo riêng freshness.

Chưa nên redesign planner, thêm agent hoặc thêm tool. Thứ tự hợp lý là chứng minh recovery boundary và state freshness trước, rồi mới đo verified foothold và constructed-state planning.

---

## Phụ lục — nội dung kèm theo trong file gốc

Phần dưới giữ nguyên văn như trong file gốc (gồm dòng điều khiển hội thoại và bản tóm tắt phiên làm việc trước đó).

```text
▣  Build · GPT-6.1 Sol · 22m 16s
viết toàn bộ nội dung câu trả lời trên thành 1 file markdown
+ Thought: 17.3s
```

### Objective

- Audit kiến trúc AI Agent của repo Raptix (autonomous red team platform, HEAD f41b6fa) để tìm bottleneck thật sự theo 3 vùng (Initial Foothold / Network Propagation / Action on Objectives): phase routing, foothold boundary, state/KG, verification, contracts, observability. Chỉ audit — không sửa code, không đề xuất feature mới khi chưa có evidence; output cuối là bảng bottleneck ưu tiên + TOP 5 + ablation experiments + trả lời 5 câu hỏi.

### Important Details

- Evidence notation: S=static wiring, R=runtime artifacts, H=impact cần experiment. Repo là uv workspace monorepo: raptix-core (contracts, zero langchain), raptix (framework/runtime), raptix-sdk.
- Runtime evidence chính (A1): 204/224 (91.1%) parent AI messages gọi ls("/workspace/t2-A1/recon"), chỉ 2 dạng kết quả lặp (150+54 lần), ~10,005,262/11,298,744 parent tokens; 6 task() recursion error, 4 [TERMINAL]; max parent input 122,570 tokens. Đây là no-information/recovery loop thật.
- A1/B1 không phải A/B hợp lệ: khác arm image (A=e3abfc9, B=ecd0c04), prompt sha, RoE sha, ground-truth denominator (116 vs 7). workspace/t2-{A1,B1}/events.jsonl tích lũy nhiều lượt — không dùng tổng làm số liệu 1 run. benchmark/juice_shop_t2.py:530-540 tính token_count parent-only.
- Phase routing: không có current_phase cấp engagement; phase nằm trên từng objective (ObjectivePhase: recon/initial-access/post-exploit/c2/exfiltration trong raptix_core/types/engagement.py:37-52); routing do orchestrator LLM qua task(); tools/opplan.py:652-741 chỉ validate status transitions/blocked_by, không check verified foothold/session/capability.
- Không có structured foothold artifact load-bearing: exploit success ≠ managed session ≠ usable capability chưa tách bằng control contract.
- KG freshness bug S: KGMiddleware hydrate summary ở before_agent; tool→model loop không chạy lại before_agent (.venv/.../langchain/agents/factory.py:1566-1617); KGStore.revision() dùng max node lastupdated theo giây — edge-only/same-second writes không bump revision. Summary thiếu session/credential/reachability (chỉ top-5 vulns, 3 entrypoints, crown-jewel path counts).
- postexploit không có KG tools (chỉ killchain_lookup + BASH_TOOLS); graph algorithms (plan_chains, critical_path_score, impact_analysis, credential_reachability trong tools/research/chain.py) tồn tại nhưng không expose cho main planner — chỉ kg_surface_inventory cho decepticon.
- Contract mâu thuẫn S/R: orchestrator bảo load exploit router skill nhưng default skill sources (middleware_slots.py:89-109) không gồm exploit tree; startup dùng /standard/raptix/ nhưng packaged tree là /standard/decepticon/ (B1 ghi nhận "no Skill at path"); exploit được hướng dẫn OPPLAN tools nhưng không có trong SLOTS_PER_ROLE; postexploit vs post-exploit skill name mismatch.
- Failure/termination chỉ là text: core/subagent_streaming.py _consecutive_failures nằm trên runnable instance theo role (không objective-scoped); [TERMINAL] chỉ thay nội dung error, không chặn dispatch kế tiếp; A1 có terminal rồi vẫn tiếp tục dispatch.
- KHÔNG flag "parent history injection": deepagents 0.6.8 subagents.py:534-540 thay child messages bằng HumanMessage(description). agents/task_spec.py (SubAgentTaskSpec + scoped_dispatch_payload) đã định nghĩa nhưng chưa integrated; runtime/task_spec.py là contract CART replay.
- Fact vs hypothesis: KGStore có provenance (engagement/firstseen/lastupdated/created_by/source_episode_id) nhưng không confidence/verification status/expiry; nuclei ingest có thể thành "viable path" fact. HAS_SESSION từ BloodHound là computer→user logon, không phải usable C2 handle.
- TOP 5 bottleneck (theo thứ tự): (1) failure/terminal chỉ text — subagent_streaming.py:216-228,653-673; (2) KG summary stale trong propagation loop — middleware/kg.py; (3) foothold boundary dựa completion không verified access — tools/opplan.py:652-741; (4) planner reason trên narrative thay operational state — kg_internal/summary.py + slots; (5) IF contract mâu thuẫn — prompts + skill ACL. Mỗi cái có minimum ablation experiment đã ghi trong báo cáo.
- Trả lời 5 câu: loss lớn nhất quan sát được ở Initial Foothold/orchestration recovery; bottleneck chủ yếu từ harness/interface (chưa có model-swap ablation); IF không over-controlled toàn bộ (candidate: cell lock, classification ownership); NP under-controlled ở decision boundary, thiếu structured state; smallest change = typed failure/terminal outcome ở dispatch boundary.

### Work State

#### Completed

- Toàn bộ audit mục A-T: đọc CLAUDE.md/CONTRIBUTING_AGENT.md/docs/QUALITY_BAR.md; trace 16+ agent factories, middleware slots, OPPLAN, KG middleware stack, skills/skillogy, event log, recording, budget, verification, ops tools.
- Đo runtime metrics từ events.jsonl + transcript.json bằng Python one-liners (aggregate llm/tool calls, token usage per agent, repeated ls, task outcomes [TERMINAL]/recursion errors).
- Bàn giao báo cáo cuối: bảng 11 bottlenecks (P0-1 → P2-11) với exact code path/evidence/metric/experiment; TOP 5 với minimum ablation experiments; trả lời đủ 5 câu hỏi cuối.
- Todos: cả 4 item đã marked completed.

#### Active

- (none) — báo cáo audit đã bàn giao đầy đủ.

#### Blocked

- (none) — lưu ý limitations đã ghi trong báo cáo: chưa có archived multi-host propagation run (path-follow rate/false-capability rate chưa đo được); rg không có sẵn trên Windows PowerShell (dùng python -B -c one-liners thay thế); archived T2 transcript không giữ subagent_transcripts.

### Next Move

1. (none) — audit hoàn tất. Nếu user muốn tiếp tục: chạy minimum ablation experiments theo TOP 5, bắt đầu từ experiment 1 (current error text vs typed failure/terminal outcome trên cùng recorded failed dispatch) và experiment 2 (KG summary cached-at-entry vs refresh-before-decision, test edge-only + same-second writes riêng).
2. (none)

### Relevant Files

- `D:\.VTNet\redteam\raptix` — repo root, HEAD f41b6fa.
- `packages/raptix/raptix/agents/standard/decepticon.py` — orchestrator factory (tools=[], mọi offensive work qua task()).
- `packages/raptix/raptix/agents/middleware_slots.py` — slot registry; _make_subagent(); kg_surface_inventory chỉ cho decepticon (dòng ~229); default skill sources (89-109).
- `packages/raptix/raptix/agents/task_spec.py` — SubAgentTaskSpec/scoped_dispatch_payload, chưa integrated.
- `packages/raptix/raptix/core/subagent_streaming.py` — _consecutive_failures, [TERMINAL] handling (216-228, 653-673).
- `packages/raptix/raptix/middleware/opplan.py` + `packages/raptix/raptix/tools/opplan.py` — OPPLAN middleware/tools, _VALID_TRANSITIONS, validation 652-741.
- `packages/raptix/raptix/middleware/kg.py` + `middleware/kg_internal/{store,summary,tools,ingest,state}.py` — KGMiddleware lifecycle (freshness bug), KGStore (revision/record_observations/snapshot props_json mismatch 240-307 vs 435-484), summary block, kg tools, scanner ingest.
- `packages/raptix/raptix/middleware/tried_edges.py` — tried-edge ledger (opt-in, exit_zero=success).
- `packages/raptix/raptix/middleware/event_logging.py` + `runtime/event_log.py` + `runtime/recording.py` — EventLog (summaries only), Recording/ReplayMiddleware (không nằm trong standard slots).
- `packages/raptix/raptix/tools/research/chain.py` + `tools/research/tools.py` — plan_chains/critical_path_score/impact_analysis/credential_reachability/plan_attack_chains/suggest_objectives_from_chains (chưa load-bearing cho propagation).
- `packages/raptix/raptix/tools/verification.py` + `tools/research/poc.py` — validate_workspace_finding/validate_poc (plugin lane, không phải prerequisite postexploit).
- `packages/raptix-core/raptix_core/types/engagement.py` — ObjectivePhase/ObjectiveStatus (37-52, 445).
- `packages/raptix-core/raptix_core/types/kg.py` — NodeKind/EdgeKind (Session, Credential, HAS_SESSION, CAN_ACCESS...).
- `packages/raptix-core/raptix_core/contracts/slots.py` — MiddlewareSlot, SLOTS_PER_ROLE (205-207: postexploit/exploit không có OPPLAN slot).
- `packages/raptix/raptix/agents/standard/{exploit,surface_exploit,postexploit,recon,ad_operator}.py` — tool surfaces từng specialist.
- `packages/raptix/raptix/agents/prompts/standard/{decepticon,exploit,postexploit,surface_exploit,recon}.md` + `agents/prompts/workflows/{decepticon,exploit,postexploit}.md` — nguồn contract mâu thuẫn.
- `.venv/lib/python3.13/site-packages/deepagents/middleware/subagents.py` (0.6.8) — dispatch: child nhận HumanMessage(description) (534-540), return = last non-empty AI text (494-531).
- `.venv/lib/python3.13/site-packages/langchain/agents/factory.py` (1566-1617) — bằng chứng before_agent/loop entry.
- `workspace/t2-juice-b1/runs/{A1,B1}/` — transcript.json, metrics.json, provenance.json, REPORT.json (A1: status timeout, 28/116 passed; B1: 2/7).
- `workspace/t2-{A1,B1}/events.jsonl` — event logs tích lũy (11,835 / 3,156 events).
- `benchmark/juice_shop_t2.py` — T2 A/B harness; token aggregation parent-only (530-540).
