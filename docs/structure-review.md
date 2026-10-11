# Nêu quan điểm kiến trúc

> **Note (2026-10-11):** formalized as
> [ADR-0049](adr/0049-evidence-model-extends-capability-contract.md), which
> verifies this review's claims against the live repo, confirms its P3/P4
> deferral gating, and flags one duplication risk this review did not catch
> (a second "Observation" concept vs. the existing
> `capability.Observation`). Read ADR-0049 first.

## Response:
11/10/2026, 15:24:46 · gpt-6-thinking

Sau khi đối chiếu **graph-recommendation.md**, **exploitation-reasoning-epistemic-core.md** và toàn bộ cuộc thảo luận, mình đề xuất chốt định hướng cho Raptix như sau\:

**Giữ kiến trúc Decepticon/Raptix đang hoạt động, cải thiện chất lượng tri thức và khả năng sử dụng graph, nhưng chưa xây thêm planner hay thay đổi toàn bộ cơ chế orchestration.**

## 1\. Những gì nên áp dụng

**1\. Phân biệt Fact – Hypothesis – Observation – Evidence**

Đây là ưu tiên cao nhất. Không cho phép inference của LLM tự trở thành verified fact. Kết quả kiểm chứng phải có trạng thái, nguồn gốc và phạm vi hiệu lực.

Tận dụng `Candidate`, `Hypothesis`, `Finding` và schema KG hiện có. **Chưa cần tạo cả năm loại node mới.**

---

**2\. Provenance cho các kết luận quan trọng**

Có thể truy ngược từ finding/claim về observation, execution, agent, scope và raw artifact.

Tận dụng `record.jsonl` và artifact store. Không cần lưu mọi tool call thành `Action` node trong Neo4j.

---

**3\. Phát huy graph hiện tại thay vì redesign AKG**

Giữ domain-specific entities của Decepticon. Graph quản lý trạng thái và quan hệ; artifacts chứa dữ liệu lớn.

Chỉ mở rộng schema khi có một graph query hoặc failure case cụ thể yêu cầu.

---

**4\. Graph cung cấp structured context cho planner**

Cung cấp những thứ như `verified_state`, `open_hypotheses`, `claim_provenance` thông qua API hiện có hoặc adapter mỏng.

Không để planner phụ thuộc trực tiếp vào chi tiết Cypher; cũng không cần tạo nhiều tầng repository/service nếu API hiện tại đã đáp ứng.

---

**5\. Security hypothesis thay vì CVE-first reasoning**

CVE là một nguồn sinh giả thuyết, ngang với authorization, business logic, misconfiguration và các nhóm khác.

Không loại bỏ CVE skill đang hoạt động tốt; trước mắt chỉ cần tránh ưu tiên CVE một cách cứng nhắc.

---

**6\. Kiểm thử correctness độc lập với target**

Kiểm tra RoE qua mọi execution path, provenance, dedup evidence theo lineage, contradictory observations và cách xử lý claim hết hiệu lực.

Dùng fixtures và scripted scenarios nhỏ trước, không cần xây simulator hoàn chỉnh.

## 2\. Những gì cần cân nhắc, chưa nên chốt triển khai

| Đề xuất | Lý do chưa chốt | Khi nào nên xem xét lại |
|--------|--------|--------|
| **Exploration Planner riêng** | Có thể chồng trách nhiệm OPPLAN | Khi chứng minh OPPLAN không quản lý được exploration cần thiết |
| **Adaptive frontier search** | Chưa rõ có tốt hơn policy đơn giản | Khi có decision scenarios so sánh được |
| **Action utility / Information Gain** | Chưa có xác suất và cost được hiệu chỉnh | Khi heuristic đơn giản không đáp ứng |
| **Dynamic agent fan-out** | Chưa xác định exploration hay dispatch là bottleneck | Khi có trace hoặc thử nghiệm đối chứng |
| **Graph-derived CandidateTransition** | Có thể hạn chế khám phá hướng mới | Khi cần planning đa bước có dependency rõ |
| **AttackState planning projection** | Tăng lớp abstraction, logic và đồng bộ | Khi traversal hiện tại thực sự sinh path sai |
| **Action/Evidence first-class graph nodes** | Có thể trùng recording và provenance hiện có | Khi truy vấn dựa trên reference không đủ |
| **Graph-driven Phase Engine** | Dễ cạnh tranh quyền điều khiển với OPPLAN | Khi có failure case mà cách dùng OPPLAN hiện tại không xử lý được |

Điểm quan trọng nhất: **frontier search, fan-out và Exploration Planner là các lựa chọn policy**, không phải điều kiện tiên quyết để có một epistemic model tốt.

## 3\. Những gì nên gác lại hoặc loại bỏ khỏi phạm vi hiện tại

Redesign toàn bộ ontology và migration KG chỉ để đạt một mô hình canonical mới.

Biến toàn bộ Action, Observation, Evidence, VerifiedFact thành những graph node bắt buộc.

Tạo control plane mới gồm Phase Engine + Transition Engine + Exploration Planner cùng lúc.

Ép mọi hành động agent phải sinh ra từ graph transition generator.

Full event sourcing, graph revision engine, versioned attack-path lifecycle.

Triển khai toàn bộ W3C-PROV ontology hoặc thiết kế trước hạ tầng HRL chưa dùng đến.

Những thứ này không sai về mặt lý thuyết. Nhưng hiện chưa đủ bằng chứng để biện minh cho chi phí phát triển và bảo trì.

## 4\. Kiến trúc mục tiêu nên giữ đơn giản

**OPPLAN + Existing Agent Orchestration**

Mission planning, dispatch, delegation

**Graph Context + Evidence Contracts**

Verified state, hypotheses, observations, provenance

**Existing Neo4j KG**

Semantic state và relationships

**Existing Records**

Execution traces và raw artifacts

---

Existing RoE / Scope Enforcement

Không cần thêm subsystem lớn.

Đặc biệt, **Epistemic Core nên là một tập hợp data contracts và invariants được thực thi trên hạ tầng hiện tại**, không mặc nhiên là một service, database hay hệ thống state riêng.

## 5\. Thứ tự triển khai đề xuất

| Ưu tiên | Công việc | Kết quả cần có |
|--------|--------|--------|
| P0 | Inventory các nguồn state hiện có | Biết chỗ nào trùng lặp, thiếu dữ liệu |
| P0 | Test RoE trên execution paths | Chứng minh enforcement thực sự hoạt động |
| P1 | Evidence contract tối thiểu | Phân biệt và kiểm chứng các claim |
| P1 | Provenance linking | Truy xuất được từ finding tới execution |
| P2 | Graph context queries | Planner nhận đúng thông tin cần thiết |
| P2 | Graph correctness fixtures | Kiểm chứng state và relationship semantics |
| P3 | Decision harness nhỏ | Đánh giá lựa chọn planning policy |
| P4 | Frontier/projection/fan-out | Chỉ triển khai nếu chứng minh được lợi ích |

Không nhất thiết phải hoàn thành tất cả mới tiếp tục phát triển Raptix. P0–P2 là cải thiện nền tảng; P3–P4 là thử nghiệm các giả thuyết kiến trúc.

---

## 6\. Năm nguyên tắc mình đề xuất đưa vào ADR

1. **One owner per state\:** Mỗi loại trạng thái có đúng một nguồn authoritative; không đồng bộ những bản sao canonical không cần thiết.
2. **Evidence before truth\:** Mọi claim được xác minh phải có nguồn gốc và điều kiện xác minh; inference không tự nâng thành fact.
3. **Graph informs, planner decides\:** Graph cung cấp trạng thái, quan hệ và các gợi ý; OPPLAN/planner chịu trách nhiệm quyết định trong giới hạn được phép.
4. **Extend before replace\:** Ưu tiên mở rộng schema và module có sẵn trước khi tạo hệ thống mới.
5. **Prove the need for abstraction\:** Mọi subsystem mới phải có consumer, failure mode và phép kiểm thử chứng minh giá trị.

## Kết luận chốt

Mình đề xuất chỉ giữ **hai trọng tâm phát triển chính**\:

**Evidence-grounded Knowledge Graph**

Nâng chất lượng state, provenance, uncertainty và khả năng truy vấn của KG hiện có.

---

**Evidence-informed Planning**

Giúp OPPLAN và agent sử dụng evidence để cập nhật quyết định, thay vì lập tức xây thêm Exploration Planner hoặc Graph-driven Orchestrator.

**Mình sẽ giữ nguyên OPPLAN, KG và DispatchMiddleware trước mắt.** Chỉ can thiệp vào cấu trúc của chúng khi đã xác định được hạn chế cụ thể.

Vertical/horizontal là nhãn hoặc góc nhìn suy ra từ thay đổi capability đã được xác minh, không cần hai loại agent. CVE là một nguồn hypothesis, không phải trục kiến trúc. Breadth/depth và fan-out là quyết định policy, chưa nên hard-code.

Và mình sẽ giữ một quy tắc cuối cùng\:

**Ưu tiên loại bỏ ambiguity và duplicated state trước khi thêm intelligence hoặc abstraction mới.**

Đây là hướng mình đánh giá cân bằng nhất giữa khả năng reasoning, tính mở rộng và tránh over-engineering cho Raptix hiện tại.

## Prompt:
11/10/2026, 15:34:04

vậy làm sao để hệ thống có thể khai thác thật tốt, để dù model yếu nhưng vẫn reasoning tốt và khai thác không kém gì model mạnh (astra, opus 5.5)?

## Response:
11/10/2026, 15:34:16 · gpt-6-thinking

Từ các nghiên cứu về agent, có một hướng khá nhất quán: thiết kế interface, cách chia nhiệm vụ và cơ chế kiểm chứng có thể cải thiện kết quả đáng kể mà không cần tăng độ phức tạp của multi-agent orchestration. Nhưng các kết quả đó chủ yếu đến từ software engineering và benchmark có kiểm soát; mình sẽ không suy diễn rằng chúng chứng minh model nhỏ có thể ngang model frontier trong red team thực tế.

> **Định hình kiến trúc**
>
> Mình đang tập trung vào việc nâng năng lực mô hình yếu bằng vòng lặp giả thuyết–kiểm chứng, công cụ ổn định, bộ nhớ trạng thái, trình xác minh độc lập và đánh giá trong môi trường được ủy quyền, thay vì chỉ tăng độ dài prompt.
>
> **Đã định hình kiến trúc**
>
> 
>
> **Tinh chỉnh năng lực**
>
> Mình đang xem xét cách bù đắp giới hạn của mô hình yếu bằng quy trình có cấu trúc: giả thuyết, bằng chứng, kiểm chứng độc lập, trạng thái kiểu hóa, nhánh thất bại và đánh giá trên phòng thí nghiệm được ủy quyền.
>
> **Đã tinh chỉnh năng lực**
>
> 
>
> **Đã tìm kiếm 16 trang web**
>
> 
>
> Đã xử lý trong 1m 9s

Mình nghĩ đây mới là câu hỏi quan trọng nhất đối với Raptix.

**Làm thế nào để năng lực kiểm thử bảo mật của hệ thống phụ thuộc ít nhất có thể vào độ thông minh của model?**

Mục tiêu của bạn rất đáng theo đuổi, nhưng mình muốn phân biệt hai điều\:

- **Có thể\:** Khiến model nhỏ/yếu thực hiện đáng tin cậy những nhiệm vụ mà nếu không có hệ thống hỗ trợ, nó thường thất bại. Giảm đáng kể khoảng cách với model mạnh trong những tình huống có cấu trúc và có thể kiểm chứng.
- **Không thể bảo đảm\:** Một model yếu luôn khai thác hoặc khám phá lỗ hổng tốt ngang model mạnh trong mọi trường hợp, đặc biệt với business logic mới lạ, suy luận nhiều bước chưa từng gặp và thông tin mơ hồ.

Theo mình, Raptix không nên cố tạo ra một *LLM biết khai thác giỏi hơn*\. Nó nên trở thành một **hệ thống kiểm thử bảo mật có khả năng hỗ trợ, kiểm tra và sửa sai cho suy luận của LLM**\.

Và điều quan trọng: bạn không cần xây thêm hàng loạt agent hay một graph reasoning engine khổng lồ để đạt được mục tiêu đó.

## 1\. Bằng chứng nghiên cứu cho hướng tiếp cận này

Có ba kết quả nghiên cứu mình nghĩ rất phù hợp với Raptix\:

- **entity["other","SWE-agent","Language model agent framework for software engineering"]\:** Nghiên cứu cho thấy thiết kế Agent-Computer Interface chuyên biệt có thể cải thiện đáng kể khả năng sử dụng công cụ và giải quyết vấn đề của LLM. Tức là model không nhất thiết phải tự xử lý toàn bộ sự phức tạp của môi trường. citeturn252233academia50
- **entity["other","Agentless","Simplified framework for LLM-based software issue resolution"]\:** Một pipeline đơn giản gồm định vị vấn đề, sửa và xác minh từng vượt nhiều hệ thống agent phức tạp trên SWE-bench Lite ở thời điểm công bố. Đây là bằng chứng chống lại giả định rằng nhiều agent hoặc nhiều reasoning layers tự động tốt hơn. citeturn927424academia48
- **entity["other","ReAct","Reasoning and Acting language model research"]\:** Xen kẽ reasoning với quan sát từ môi trường giúp agent cập nhật quyết định thay vì phụ thuộc hoàn toàn vào lập kế hoạch ban đầu. citeturn927424academia49

Các kết quả này không chứng minh hiệu năng khai thác bảo mật của Raptix. Nhưng chúng gợi ý một nguyên tắc kiến trúc có cơ sở\:

**Chuyển những công việc mà phần mềm có thể làm chính xác ra khỏi LLM. Chỉ sử dụng LLM cho những quyết định thực sự cần suy luận ngữ nghĩa.**

## 2\. Sáu năng lực mình muốn tối ưu trong Raptix

**A. Khả năng hình thành giả thuyết có cơ sở**

Model yếu thường không tự nghĩ ra được nhiều khả năng cần kiểm tra, hoặc bị hút vào những hướng quen thuộc như CVE.

Giải pháp không phải đưa toàn bộ skill corpus vào context. Hãy dùng các *hypothesis templates* nhỏ, theo từng nhóm bất biến bảo mật: authentication, authorization, isolation, configuration và workflow integrity.

Mỗi template chỉ cung cấp điều kiện áp dụng, câu hỏi cần xác minh, loại bằng chứng mong đợi và điều kiện dừng. Đây là reasoning scaffolding, không phải một kịch bản khai thác cứng.

---

**B. Tool interface dễ hiểu với model yếu**

Model không nên phải tự diễn giải hàng nghìn dòng output hoặc suy đoán ý nghĩa từ một command exit code.

Tool adapter nên trả về dữ liệu cấu trúc: `status`, `observations`, `artifacts`, `limitations`, `errors`\.

Việc phân tích cú pháp, chuẩn hóa output, nhận diện lỗi kỹ thuật và kiểm tra dữ liệu nên do code đảm nhiệm khi có thể.

---

**C. Verification không phụ thuộc lời tự khẳng định của LLM**

Model yếu đặc biệt dễ diễn giải một tín hiệu mơ hồ thành thành công.

Raptix nên phân biệt kết quả `supported`, `contradicted` và `inconclusive`\. Khi có tiêu chí xác minh khách quan, dùng validator xác định; khi không có, giữ kết luận ở trạng thái chưa xác minh hoặc yêu cầu review.

Không cần một Verifier Agent mới cho mọi nhiệm vụ.

---

**D. Khả năng sửa sai dựa trên observation**

Sau một kết quả mới, hệ thống cần biết giả thuyết nào bị ảnh hưởng và liệu kế hoạch còn hợp lý không.

Không nên cho LLM tiếp tục lặp lại những hướng thiếu tín hiệu chỉ vì OPPLAN chưa hoàn thành.

Ngược lại, cũng không nên tự động xem một lần kiểm chứng thất bại là bằng chứng bác bỏ toàn bộ giả thuyết.

---

**E. Context và memory đáng tin cậy**

Graph nên giúp model nhận được đúng những facts, hypotheses, failed attempts và observations liên quan tới quyết định hiện tại.

Không đẩy cả AKG vào context. Không để kết luận của agent trước trở thành sự thật chỉ vì đã được ghi trong memory.

Những cải tiến context isolation mà bạn đã thực hiện ở Raptix là nền tảng phù hợp cho hướng này.

---

**F. Exploration có kiểm soát**

Đừng khóa model vào một OPPLAN bất biến, nhưng cũng đừng để nó spawn agent vô hạn.

Cho phép đề xuất những giả thuyết mới và đánh giá chúng ở các decision checkpoints. Scheduler hiện có quản lý concurrency, budget và scope.

Chưa cần triển khai best-first frontier, Bayesian IG hay một Exploration Planner riêng.

## 3\. Cơ chế quan trọng nhất: Hypothesis → Verification → Update

Nếu chỉ được chọn một cải tiến về reasoning để triển khai trước, mình sẽ chọn một **vòng lặp kiểm chứng giả thuyết có cấu trúc**, gắn vào agent workflow hiện có.

**1\. Relevant Context**

OPPLAN objective + KG facts + unresolved hypotheses

**2\. Hypothesis Proposal**

LLM đề xuất một claim và cách xác minh phù hợp

**3\. Scope Gate + Verification**

Kiểm tra quyền thực thi, thu observation bằng tool hiện có

**4\. Evidence Assessment**

Supported / Contradicted / Inconclusive

**5\. Decision Update**

Tiếp tục, sửa giả thuyết, đổi hướng hoặc kết thúc

Quay lại context khi xuất hiện thông tin có ý nghĩa

Điểm khác biệt so với cách chỉ prompt model “hãy suy nghĩ kỹ” là hệ thống có một hợp đồng rõ ràng giữa các bước.

Ví dụ, trong môi trường kiểm thử API được cấp phép\:

Model đề xuất giả thuyết rằng một ranh giới authorization không được thực thi nhất quán. Hệ thống yêu cầu xác định ranh giới kỳ vọng, điều kiện kiểm thử hợp lệ, observation cần thu và điều gì sẽ làm giả thuyết bị bác bỏ.

Một kết quả không đủ rõ ràng sẽ không được tự động coi là vulnerability.

Đây là cách phần mềm có thể giúp model yếu tránh những kết luận mà model mạnh hơn có khả năng tự nhận ra.

Tuy nhiên, hợp đồng này không tự tạo ra khả năng suy luận mới. Nếu model chưa từng nghĩ đến ranh giới authorization đó, hệ thống vẫn cần hypothesis templates, coverage guidance hoặc kiến thức bên ngoài để mở rộng tập giả thuyết.

## 4\. Skills mới là nơi có thể tạo ra lợi thế lớn - nếu thiết kế đúng

Trong Raptix, mình nghĩ skills có tiềm năng tạo giá trị trực tiếp hơn việc xây lại toàn bộ graph.

Nhưng phải phân biệt hai kiểu skill.

| Skill thiên về tài liệu | Skill thiên về quyết định |
|--------|--------|
| Giải thích kỹ thuật, thuật ngữ và công cụ | Chỉ rõ khi nào nên áp dụng |
| Đưa ra những ví dụ tổng quát | Nêu điều kiện tiên quyết và bất biến cần kiểm tra |
| LLM tự xác định thành công | Có tiêu chí xác minh rõ |
| LLM tự quyết định retry | Có điều kiện dừng và xử lý inconclusive |
| Dễ trở thành tài liệu dài trong context | Có thể nạp phần hướng dẫn liên quan đến quyết định hiện tại |

Mình không đề xuất đổi hàng trăm `SKILL.md` thành một DSL mới.

Trước mắt, hãy chọn một vài skill quan trọng và thêm phần **decision contract** ngắn\:

```yaml
hypothesis_family: authorization_boundary

applicability:
  - scoped_resource_identified
  - expected_access_policy_known

verification_contract:
  expected_observation: access_policy_result
  inconclusive_when: insufficient_context
  requires_evidence: true

stop_conditions:
  - scope_not_authorized
  - verification_completed
  - budget_exhausted
```

Đây chỉ là ví dụ mô tả contract; không cần xây một skill engine riêng để đọc nó. Một adapter hoặc structured instruction có thể đủ cho phiên bản đầu.

Và phải tránh biến skill thành luật cứng khiến model không thể nhận ra những trường hợp mới.

## 5\. Graph nên hỗ trợ model yếu ở điểm nào?

Mình sẽ không giao cho graph trách nhiệm tự sinh toàn bộ chiến lược.

Thay vào đó, graph giúp giải quyết ba giới hạn phổ biến của model nhỏ\:

| Điểm yếu model | Graph có thể hỗ trợ |
|--------|--------|
| Quên facts sau nhiều lượt | Truy xuất trạng thái đã xác minh |
| Không liên kết được nhiều observations | Truy vấn quan hệ và evidence lineage |
| Lặp lại hướng đã kiểm tra | Truy xuất các attempts và kết luận liên quan |

Một graph query trả về thông tin vừa đủ có thể giá trị hơn việc tăng thêm nhiều nghìn token context.

Ví dụ, trước quyết định tiếp theo, agent nhận\:

```yaml
objective: assess_authorization_boundary

known:
  - verified_identity_context
  - expected_resource_policy

open_hypotheses:
  - authorization_consistency

recent_outcomes:
  - verification_inconclusive

next_decision:
  - gather_missing_context
  - revise_hypothesis
  - stop_with_insufficient_evidence
```

Đây là *decision context*, không phải toàn bộ subgraph.

Và chính xác là loại thông tin mà một model yếu có thể xử lý tốt hơn so với một đoạn lịch sử dài chứa command output, phỏng đoán và kết quả cũ bị trộn lẫn.

## 6\. Cách nâng năng lực mà không over-engineering

Mình sẽ phân biệt rất rõ giữa những kỹ thuật nên làm trước và những kỹ thuật chưa đủ lý do để đưa vào Raptix.

| Kỹ thuật | Mức ưu tiên | Quan điểm |
|--------|--------|--------|
| Structured tool observations | Rất cao | Giảm yêu cầu diễn giải output |
| Hypothesis verification contract | Rất cao | Giảm kết luận sai và reasoning drift |
| Relevant KG context | Cao | Tận dụng hạ tầng đã có |
| Skill decision guidance | Cao | Bù đắp kiến thức tác vụ |
| Evidence-driven replanning | Cao | Cải thiện long-horizon behavior |
| Bounded alternative hypotheses | Trung bình | Hữu ích nếu model bỏ sót hướng |
| Multi-agent debate | Thấp | Tốn token, có thể lặp cùng sai lầm |
| Bayesian frontier scorer | Thấp hiện tại | Thiếu dữ liệu xác suất được hiệu chuẩn |
| Full graph transition engine | Thấp hiện tại | Có nguy cơ bóp nghẹt khám phá mới |
| Fine-tuning model chuyên biệt | Để sau | Cần tập dữ liệu và error taxonomy tốt |

Một điều dễ bị đánh giá thấp: nhiều lần suy luận từ cùng một model không tạo ra những bằng chứng độc lập. Ba subagent đồng ý với nhau chưa chắc đáng tin hơn một phép kiểm chứng khách quan.

Mình sẽ ưu tiên verification từ môi trường hơn là voting giữa các LLM.

## 7\. Đo xem model yếu đã được hỗ trợ tốt hơn thật chưa

Vì bạn chưa có target thực tế, mình đề xuất một phép thử tập trung vào **capability gap**, không chỉ success rate.

Chạy cùng những scripted scenarios và lab được cấp phép với bốn cấu hình\:

| Cấu hình | Model | Scaffolding |
|--------|--------|--------|
| A | Yếu | Raptix hiện tại |
| B | Yếu | Raptix cải tiến |
| C | Mạnh | Raptix hiện tại |
| D | Mạnh | Raptix cải tiến |

Điều cần quan sát không chỉ là B có gần C hay không, mà còn là B có cải thiện đáng kể so với A không, và D có còn vượt xa B không.

Các chỉ số nên bao gồm\:

- Tỷ lệ hypotheses hữu ích được hình thành so với tập tham chiếu.
- Tỷ lệ kết luận được xác minh đúng.
- False-positive rate và inconclusive handling.
- Khả năng cập nhật quyết định sau contradictory evidence.
- Số lần lặp lại hành động không mang thêm thông tin.
- Chi phí, thời gian, token và vi phạm phạm vi kiểm thử.

Sử dụng scenario giữ lại chưa từng dùng để tinh chỉnh. Nếu không, một model yếu có thể chỉ học được cách đáp ứng những tình huống do chính harness tạo ra.

Ngoài ra, các benchmark như entity["other","CyberGym-E2E","End-to-end cybersecurity agent benchmark"] cho thấy đánh giá an ninh end-to-end khác đáng kể với chỉ đánh giá một bước phát hiện hoặc tái hiện lỗ hổng. citeturn252233search3

## 8\. Những thay đổi cụ thể mình sẽ làm ở Raptix

Mình sẽ không bắt đầu bằng một ADR khổng lồ.

**PR 1 - Structured verification contract**

Chuẩn hóa cách agent diễn đạt hypothesis, observation, conclusion và evidence references; bổ sung validation và failure handling. Không cần graph migration.

---

**PR 2 - Skill guidance cải tiến**

Áp dụng decision guidance cho một số skill đại diện, đo xem model yếu có giảm lỗi chọn sai hướng hoặc nhận định thiếu bằng chứng không.

---

**PR 3 - Evidence-aware OPPLAN update**

Sử dụng observations và trạng thái hypothesis để đề xuất điều chỉnh kế hoạch ở những checkpoints có ý nghĩa. Không xây planner thứ hai.

---

**PR 4 - Capability evaluation harness**

Đánh giá riêng hypothesis generation, verification, replanning và chi phí. So sánh các model và ablation từng cải tiến.

Các PR này có thể làm tăng độ tin cậy của hệ thống mà không cần thiết kế lại toàn bộ kiến trúc multi-agent.

---

## 9\. Nhưng còn một giới hạn không thể bỏ qua

Mình muốn phản biện trực tiếp mong muốn *model yếu nhưng không kém model mạnh*\.

Có ba loại năng lực khác nhau\:

**Năng lực mang tính thủ tục\:** làm đúng chuỗi thao tác, dùng công cụ, thu thập dữ liệu, ghi nhận kết quả. Loại này có thể cải thiện mạnh bằng scaffolding và deterministic code.

**Năng lực suy luận dựa trên kiến thức đã có\:** nhận diện các bất biến bảo mật, kết nối facts và lựa chọn phép kiểm chứng thích hợp. Loại này có thể cải thiện qua skills, graph context và feedback.

**Năng lực khám phá mới\:** hình thành những giả thuyết chưa được biểu diễn trong templates, nhận ra những mối quan hệ bất thường, suy luận qua ngữ cảnh chưa gặp. Loại này khó bù đắp hơn nhiều nếu model nền yếu.

Một hệ thống tốt có thể giảm khoảng cách lớn ở hai loại đầu. Nhưng loại thứ ba vẫn phụ thuộc đáng kể vào năng lực model, chất lượng dữ liệu và mức độ mới lạ của bài toán.

Vì vậy, mình sẽ không đặt **model parity** thành architectural invariant. Nó nên là mục tiêu đánh giá thực nghiệm theo từng nhóm nhiệm vụ.

## Chốt lại hướng phát triển

Theo mình, Raptix cần ba thứ, theo đúng thứ tự\:

**1\. Knowledge scaffolding**

Cung cấp những kiến thức và cấu trúc suy luận mà model yếu thường thiếu.

---

**2\. Evidence-grounded feedback**

Ngăn model suy luận sai từ observation, giúp sửa sai bằng bằng chứng thay vì tự tin chủ quan.

---

**3\. Adaptive decision-making**

Cho phép cập nhật hướng đánh giá khi xuất hiện evidence mới, nhưng không tạo thêm một control plane không cần thiết.

**Mình sẽ ưu tiên làm cho một agent đơn lẻ sử dụng model yếu trở nên đáng tin cậy trước, rồi mới tìm cách tăng sức mạnh bằng multi-agent, frontier search hay graph transition planning.**

Nếu một agent đơn lẻ vẫn thường xuyên hiểu sai output, quên evidence, chọn skill không phù hợp và xác minh kết quả không đúng, thì tăng fan-out chỉ nhân số lượng những sai lầm đó.

Ngược lại, khi một agent đã có workflow kiểm chứng tốt, các cải tiến về exploration và orchestration mới có cơ hội tạo thêm giá trị thực sự.

Đó là con đường mình cho là có cơ sở nhất để Raptix tận dụng model yếu hiệu quả, trong khi vẫn giữ kiến trúc đủ gọn để phát triển và kiểm chứng.

