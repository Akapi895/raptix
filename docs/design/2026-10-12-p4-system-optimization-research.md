# P4: Nghiên cứu tối ưu hệ thống Raptix

- **Ngày:** 2026-10-12. **Trạng thái:** nghiên cứu/đề xuất; đầu vào cho quyết định tối ưu và triển khai P4.
- **Kết luận chính:** tối ưu kết quả mission đã kiểm chứng trong ngân sách; trước tiên chẩn đoán bottleneck và so với policy đơn giản. P3 đã hoàn thành delivery nhưng chưa chứng minh nhu cầu frontier, AttackState projection mới hoặc dynamic fan-out.
- **Quy ước:** **[OBSERVED]** = thấy trong source/ADR hoặc checkpoint được dẫn; **[TENTATIVE]** = suy luận có cơ sở nhưng chưa kiểm nghiệm; **[OPEN]** = cần dữ liệu; **[PROPOSED]** = protocol, ngưỡng hay cách triển khai chưa được duyệt.
- Source code là căn cứ cho wiring hiện tại; các ADR được dẫn còn có `Status: Proposed`. Thảo luận cũ không ghi đè code hay tự cấp quyền thay đổi runtime. Số liệu P3 đã được đối chiếu trực tiếp với hai reports, episode journals, scores và provenance ledger trước khi hoàn thiện tài liệu.
- **Xác minh bổ sung (2026-10-13):** đọc trực tiếp code hiện tại trên nhánh `tool` (không chạy experiment/benchmark mới, không có thay đổi runtime nào từ khi tài liệu này được viết) đối chiếu từng claim `[OBSERVED]` ở §2.2, §3.1 và 6 ADR trích dẫn (0021, 0023, 0026, 0049, 0064, 0066). Toàn bộ khớp code/ADR thật, kể cả số liệu bảng P3 ở §2.1 (khớp nguyên văn `benchmarks/suites/decision_eval/README.md`) và việc `knowledge/graph/summary.py`/`operational_state.py` thật sự được `middleware/kg.py` wire vào `kg_summary`/`kg_planning_context`/`kg_operational_state` sống, không phải code mồ côi. Hai điểm được nâng cấp bằng chứng mới, đánh dấu tại chỗ ở §2.2 và §3.1: (a) `F-PROJ-JEWEL-01` không còn thuần là giả thuyết — đọc tĩnh `knowledge/graph/summary.py:360-373` xác nhận thiếu `c.key` binding; (b) cả hai hàm trong `_surface_dispatch.py` (không riêng bản batch) đều không có Python caller ngoài test.
- **Implement + live-model testing (2026-10-13, cùng ngày, tiếp theo xác minh trên):** `F-PROJ-JEWEL-01` đã fix (TDD red→green, `knowledge/graph/summary.py` + test) và kiểm chứng tác động hành vi trên 3 model thật (`custom/zai-org/GLM-5.3-Flash`, `custom/MiniMax/MiniMax-M3`, `custom/MiniMax/MiniMax-M3-VIP` — 3 model duy nhất được phép dùng cho multi-model test trong phiên này). `F-PROJ-SEMANTICS-02` đã sửa wording. Cả 5 case ở §3.1 giờ đã được chạy (static + live-model + data engagement thật); 2/5 (`F-PROJ-JEWEL-01`, `F-SHARED-ACTION-01`) + `F-COVERAGE-01` xác nhận là rủi ro/bug thật; `F-PROJ-SEMANTICS-02` và `F-REPLAN-01` không đo được tác động/không xác nhận được failure. Phát hiện nền tảng xuyên suốt (§2.2): phân tích 6 `record.jsonl` engagement HTB thật đã chạy trước đó cho thấy toàn bộ subsystem coverage-matrix B5/B6 (ADR-0023/0026) có `objective_expand`=0 lần gọi trong tất cả 6 run — baseline thật đang chạy là free-form model reasoning, không qua pipeline matrix mà phần lớn §2–§5 của tài liệu này giả định là baseline. Chi tiết đầy đủ: §3.1.1, §3.1.2, §3.3.1.

## 1. Mục tiêu và tiêu chí tối ưu

### 1.1 Đơn vị giá trị

**[PROPOSED]** Primary outcome là **mission goal yield tại ngân sách cố định**: tỷ lệ tiêu chí mission đạt được và được verifier độc lập xác nhận trong phạm vi cho phép. Với nhiều goal, khóa trọng số trước chạy; không tăng điểm bằng cách chia một finding thành nhiều claim hay tạo thêm objectives dễ hoàn tất.

Đo đồng thời: kết quả đúng, false-positive/unsupported reporting, coverage, token, số model/tool/execution calls, latency và lặp không thêm thông tin. Không tối ưu riêng số agent, số hypothesis, số node KG hoặc tỷ lệ OPPLAN `completed`: đó là hoạt động/trạng thái, không chứng minh hiệu quả bảo mật. [R3], [R5], [R10]

**[PROPOSED]** Vector ngân sách `B = (token, model_calls, tool_calls, execution_steps, wall_time, impact)` có hard ceiling riêng; chi phí USD bổ sung khi có usage/price đáng tin cậy. So yield tại cùng `B`, rồi xem đường yield–cost và Pareto trade-off; không gộp tất cả thành một utility có trọng số tùy tiện.

Coverage gồm hai mẫu số khác nhau: `(surface, security_invariant)` trong phần bề mặt quan sát được và tập cơ hội do evaluator/expert xác định. Chỉ một phép kiểm tra hợp lệ đã hoàn tất mới tăng tested coverage; được xếp hàng, đọc skill hay timeout không phải đã kiểm tra. Ghi các ô inconclusive riêng, không coi là ruled-out.

### 1.2 Chống “đẹp accuracy nhờ từ chối”

Gọi `N` là mọi episode được lên lịch, `A` là outputs qua provenance boundary, `C` là outputs đúng trong `A`:

- `coverage_bound = A/N`; `accuracy_conditional = C/A` nếu `A > 0`.
- `correct_bound_yield = C/N = coverage_bound × accuracy_conditional`; khi `A = 0`, conditional accuracy không xác định.
- Báo riêng raw joint correctness trên `N`; không giả định mọi raw-correct answer đều được boundary chấp nhận.
- Trong benchmark mission, báo đúng-abstention và goal yield riêng: dừng có lý do có thể đúng nhưng không phải đạt goal.

**[PROPOSED]** Không chọn policy chỉ vì conditional accuracy cao hơn trong khi correct-bound yield, khả năng đạt goal hoặc coverage giảm. Reject/error/timeout giữ nguyên mẫu số chính; phân tích completed-only chỉ là sensitivity analysis. Provenance hợp lệ cũng không thay verifier về nội dung. [R5], [R6]

### 1.3 Tối ưu toàn hệ thống theo critical path

**[PROPOSED]** Đo chuỗi end-to-end: nhận mission/control request → runtime/OPPLAN → model/proxy/context → chọn và dispatch action → sandbox/tool → normalization/verification/KG → replan/report. Chụp latency, compute và failure tại mỗi boundary; xếp ưu tiên theo phần làm mất verified yield hoặc chiếm tài nguyên nhiều nhất, thay vì theo tên subsystem muốn xây. [R9], [R23], [R27], [R28]

Một bảng phân rã phải tách control-plane/startup/queue, model generation, context retrieval, execution, verification và reporting. Nếu lỗi auth, executor, context hoặc truyền trạng thái là bottleneck, giải pháp tối ưu nằm tại seam đó; benchmark frontier giữ chúng cố định. Mỗi optimization chỉ được tính thắng khi lợi ích end-to-end còn tồn tại sau overhead controller, verification và recovery.

## 2. Bằng chứng và baseline hiện tại

### 2.1 P3 trả lời gì và chưa trả lời gì?

**[OBSERVED]** P3 `decision_eval` dựng agent mới cho **một replay checkpoint**; hai điều kiện cùng read-only replay tool, khác flag P2 evidence context. `ReplayStore` trả query rows đã chọn; không chạy target, OPPLAN thật, surface discovery hay Cypher thật. Golden answers nằm ở evaluator. Timeout/recursion limit chặn episode, không đo năng lực chuỗi khai thác. [R4], [R5]

P3 được chốt tại commit `33d0d32`. Hai reports dưới đây được chạy trước commit trên `c74dabf` với `git_dirty=true`; corpus hashes, initial prompts, tool schemas, completeness và scores đã được audit lại. Chúng là artifacts local ignored, không phải bằng chứng một clean-tree experiment đã được snapshot đầy đủ. [R4], [R5], [P3DEV], [P3HOLD]

| Tập | Raw joint correctness: baseline / evidence | Bound-output coverage: baseline / evidence |
|---|---|---|
| Dev, 6 scenarios | 39/90 / 42/90 | 53/90 / 60/90 |
| Held-out, 16 scenarios | 139/240 / 151/240 | 154/240 / 163/240 |

Matrix dùng 5 aliases, loại GLM-5.2, 3 repetitions, scheduling seed 7, timeout 120 giây: 180 dev + 480 held-out episodes; 1.334 completed model turns; usage/nonempty response trong 646 episodes; 14 recursion failures vẫn ở mẫu số. Không có `AuthenticationError` trong hai lượt này. Chúng không phải 660 trường hợp target độc lập. [R4], [P3DEV], [P3HOLD]

Reports: [dev local][P3DEV], [held-out local][P3HOLD]. Conditional correctness held-out là `139/154 ≈ 90,3%` và `151/163 ≈ 92,6%`, tương ứng coverage `64,2%` và `67,9%`; raw joint correctness là `57,9%` và `62,9%`. Không dùng riêng conditional accuracy để cấp GO. Các run cũ `103917/103928` là 660 `AuthenticationError`, không completions; chúng chỉ chứng minh lỗi hạ tầng, không chất lượng model.

**[OBSERVED]** `read-bound-v1` đóng băng declared lookups và `claim_replays`; chỉ bind exact workspace references từ completed, claim-scoped reads, tính lineage theo producer invocation. Nó không tra golden answer, sửa hash, đổi action/verdict, nâng raw score hoặc xác nhận vulnerability. Distinct invocations chưa chứng minh independent corroboration. [R5], [R6], [R7]

**[TENTATIVE]** Context evidence có tín hiệu cải thiện ở checkpoint, nhưng chưa có causal evidence về lợi ích frontier/fan-out. P3 cũng không đo hypothesis bị bỏ sót, uncertainty calibration, execution latency, weak/strong parity hoặc phản ứng qua nhiều bước. Không suy ra một mức tăng phổ quát từ các tỷ số này. [R4], [R8]

### 2.2 Baseline runtime thực sự làm gì?

| Seam | [OBSERVED] trong code hiện tại | Ý nghĩa cho baseline P4 |
|---|---|---|
| Wiring | `langgraph.json` → standard Raptix; build middleware/subagents theo factories và plugins | Chụp bundle/role/flag/tool inventory thực tế, không chỉ đọc `_STANDARD_TOOLS`. [R9], [R11] |
| Mission | OPPLAN có add/update/expand/collapse, priority, owner, dependencies, persistence qua sandbox backend; một OPPLAN call mỗi model step | Đã có kế hoạch động; không gọi baseline là “OPPLAN bất biến”. [R10], [R12] |
| Coverage | `kg_surface_inventory` đọc Endpoint và children, rồi registry sinh các `(vuln_class, surface_key)` cells | Có discovery-derived work nhưng giới hạn bởi bề mặt đã ghi và applicability heuristics. [R13], [R14] |
| Re-expansion | Dedup theo cell identity, generation mặc định ≤3, tổng population objectives ≤50; prompt chỉ re-expand sau `confirmed` | Đã có chaining hữu hạn; depth/growth cap khác concurrency cap. [R15], [R16] |
| Launch | Prompt chọn tối đa 3 pending cells theo priority, OPPLAN pre/post accounting tuần tự; session/output dir riêng | Existing bounded batch là control, không phải unlimited spawn. [R17], [R18] |
| Dispatch | Ledger checkpointed, fingerprint `(role, objective_id, description)`, attempt/outcome, in-flight guard, lọc private child state | Có dedup intent/typed failure, chưa đồng nghĩa dedup semantic action giữa hypotheses. [R19] |
| KG context | Summary + planning context revision-cached; claim/evidence flags default-off; operational shadow opt-in | Projection đã tồn tại; không khởi đầu từ greenfield AttackState. [R20], [R21], [R22] |
| Budget | USD middleware check trước model calls, cache spend, không chặn tool; lỗi spend provider bỏ enforcement turn đó | Chưa phải reservation token/tool/exec budget cho cả batch; harness cần hard accounting riêng. [R23] |

**[OBSERVED, 2026-10-13, phát hiện nền tảng từ 6 engagement thật]** `objective_expand` — tool duy nhất tạo ra các cell coverage-matrix con (`build_objective_expand_payload`, ADR-0023/0026) — có **0 lần gọi trong TẤT CẢ 6 record.jsonl thật** (`silentium`, `reddish`, 3 bản `silentium-smoke`, 1 `.raptix/workspace` smoke; đã grep `tool_counts` trực tiếp, không suy diễn). `objective_collapse` cũng 0 lần. `kg_surface_inventory` chỉ 1 lần (trong `silentium`), không có `objective_expand` theo sau. Dispatch `surface_exploit` duy nhất quan sát được (silentium, seq 1567) gắn vào objective chung "OBJ-002: Initial access" (do `add_objective` tạo, không qua `objective_expand`), với mô tả cell tự do do model viết ("Cell: (vuln_class=CVE/unauth-API-abuse, surface=...)"), không khớp template `_surface_exploit_payload`. → **Toàn bộ subsystem B5/B6 coverage-matrix (`_surface_registry.py`, `_surface_reexpand.py`, `_surface_dispatch.py`, ADR-0023, ADR-0026) dường như không được dùng trong thực tế** — model tự do suy luận vuln_class và tự viết mô tả cell, không qua registry/pipeline có cấu trúc. Điều này đổi khung đọc 2 case `F-SHARED-ACTION-01`/`F-COVERAGE-01` dưới đây: rủi ro được xác nhận là có thật *nếu* pipeline này được dùng, nhưng hiện tại là rủi ro "ngủ" (latent), không phải đang hoạt động — xem §3.1.2. **Quyết định cuối (§3.1.3, sau audit coverage trên cả 6 engagement): không khôi phục pipeline này — free-form chính thức là baseline.**

**[OBSERVED, mở rộng 2026-10-13]** Cả `next_surface_exploit_dispatch` (B6 tuần tự, ADR-0022) và `next_surface_exploit_batch` (fan-out, ADR-0026) trong `_surface_dispatch.py` là helper thuần có tests (`tests/unit/agents/test_surface_dispatch.py`), nhưng grep caller Python trong `packages/` chỉ thấy định nghĩa và tests cho **cả hai**, không riêng bản batch. Quy tắc 3 ở production được thể hiện trong prompt (`intelligence/prompts/standard/raptix.md`) — model tự gọi `task()` tối đa 3 lần/turn theo hướng dẫn chữ, không phải Python code gọi helper này; `DispatchMiddleware` (`middleware/dispatch.py`) chỉ chặn trùng một `dispatch_id` đang chạy (`_active` set có lock), không đếm tổng số dispatch đang chạy và không phải global semaphore cap=3. Phải đo launch/overlap thực tế, không giả định helper đã được controller gọi. [R17], [R18], [R19], [R35]

## 3. Các câu hỏi P4 cần trả lời

### 3.1 Failure nào đã có tên và bằng chứng?

**[OBSERVED]** ADR-0066 nêu lỗi P3 thật: lookup ID thay artifact ref, hash sai, citation lịch sử và lineage không được consumed reads hỗ trợ. Chúng đã có benchmark boundary xử lý; đây là lỗi citation/provenance, không phải failure chứng minh OPPLAN/frontier/scheduler thiếu năng lực. [R6]

Các case dưới đây là **[PROPOSED] reproductions từ seam đã quan sát**. Cập nhật
2026-10-13: tất cả 5 case đã được chạy. `F-PROJ-JEWEL-01` và `F-PROJ-SEMANTICS-02` đã
được tái hiện, fix và kiểm chứng bằng live-model test (§3.1.1). `F-SHARED-ACTION-01`,
`F-COVERAGE-01`, `F-REPLAN-01` đã được chạy qua live-model test + (cho 2 case đầu) data
engagement thật (§3.1.2) — 2/3 xác nhận là rủi ro thật (nhưng latent, xem §2.2), 1/3
(`F-REPLAN-01`) không xác nhận được failure ở tầng model.

| Case ID | Code evidence và giả thuyết failure | Reproduction cần có / đối chứng nhỏ nhất |
|---|---|---|
| `F-PROJ-JEWEL-01` | **[OBSERVED, fix + live-model test 2026-10-13]** `_cheapest_paths` thiếu `c.key` binding — đã fix (`AND c.key = $jewel_key`). **Tác động hành vi đã đo trên model thật**, không còn là giả thuyết: cho 3 model (`custom/zai-org/GLM-5.3-Flash`, `custom/MiniMax/MiniMax-M3`, `custom/MiniMax/MiniMax-M3-VIP`) xem đúng 2 bản PLANNING CONTEXT (buggy — cả 2 jewel chung route; fixed — route riêng), hỏi route cụ thể của jewel thứ hai. Buggy: **6/6 response trích dẫn route sai** (route của jewel khác) làm “route của payments_db”; 2/3 model (GLM-5.3-Flash, MiniMax-M3-VIP) tự flag được mâu thuẫn nội tại trong câu trả lời, **MiniMax-M3 thì không** — chấp nhận route sai mà không cảnh báo. Fixed: 6/6 response đúng. → Bug này **đã được chứng minh gây sai lệch kế hoạch thật trên model thật**, không chỉ là static code defect. Script: xem phụ lục §3.1.1. [R20] |
| `F-PROJ-SEMANTICS-02` | **[OBSERVED, fix + live-model test 2026-10-13]** Đã sửa wording (“viable path” → “graph path”, thêm caveat ở header PLANNING CONTEXT). **Live-model test cho kết quả âm (negative)**: cùng 3 model, 2 wording (“1 viable path” cũ vs “1 graph path” mới) nhúng trong một KG-state block, hỏi path có CONFIRMED hay NEEDS-VERIFICATION — **6/6 response trả lời NEEDS-VERIFICATION ở cả hai wording**, không có khác biệt đo được. Khác với `F-PROJ-JEWEL-01` (sai *fact* → gây sai lệch thật), đổi *wording* không tự nó thay đổi hành vi caution của 3 model này trong khung hỏi trực tiếp này — các model đã đủ cẩn trọng với path suy ra từ KG bất kể từ ngữ. Giữ nguyên fix wording (đúng về mặt tài liệu/trung thực) nhưng không coi đây là bằng chứng risk giảm — câu hỏi trực tiếp “CONFIRMED hay NEEDS-VERIFICATION” có thể đã prime câu trả lời cẩn trọng; chưa test trong khung ambient (không hỏi thẳng về verification) hay multi-turn agentic thật. [R20], [R22] |
| `F-SHARED-ACTION-01` | **[OBSERVED, live-model test 2026-10-13, latent risk — quyết định đóng, không fix]** Cell identity tách vuln classes (`cell_id = vuln_class::surface_key`); ADR-0021 bắt mỗi cell session bash riêng, ADR-0026 batch song song không chờ nhau — không cơ chế nào cho cell B đọc được cell A đã probe gì. **Đo thật**: 2 cell giả lập (sqli, idor) cùng `surface_key`, dispatch độc lập (không chia sẻ context, đúng session isolation thật) tới 3 model, hỏi lệnh bash đầu tiên nhằm vào target. **12/12 response** (3 model × 2 cell × 2 lần lặp) đều tự đề xuất **cùng một baseline probe** (`curl .../api/orders/1`) — trùng lặp recon thật, đo được, không chỉ là khả năng kiến trúc. **Quyết định 2026-10-13 (sau audit §3.1.3): không khôi phục coverage-matrix (ADR-0023/0026) → case này đóng, không mở PR shared-action cache.** Rủi ro chỉ tồn tại nếu matrix được dùng lại; baseline thật (free-form) không tạo ra các cell song song kiểu này nên không bị ảnh hưởng. | Đóng. Chỉ mở lại nếu có quyết định riêng khôi phục pipeline matrix trong tương lai — khi đó mới cần shared-result lookup. [R14], [R19] |
| `F-REPLAN-01` | **[OBSERVED, live-model test 2026-10-13, KHÔNG xác nhận failure]** Test multi-turn thật (2 checkpoint, không phải 1 — đúng yêu cầu của tài liệu): turn 1 model commit H1 (SQLi) + nêu follow-up phụ thuộc; turn 2 đưa evidence bác bỏ precondition (WAF giả lập lỗi SQL, không phải SQLi thật). **5/5 response hoàn thành** (3 model, 2 lần lặp, 1/6 timeout hạ tầng không tính) đều tự nhận `contradicted`/`revise_hypothesis` hoặc `stop_insufficient` và **chủ động hủy/sửa follow-up phụ thuộc đã nêu ở turn 1**, không mù quáng tiếp tục. → Khả năng replan đúng **không phải bottleneck ở tầng model** trong khung test này. Nếu failure thật tồn tại trong production, nhiều khả năng nằm ở tầng orchestration/context-engineering (model có thực sự được đưa evidence mâu thuẫn rõ ràng tại đúng checkpoint hay không), không phải ở khả năng reasoning. | Case này nên đóng theo hướng "giữ baseline, giám sát context-delivery" hơn là tiếp tục coi là named-failure OPPLAN. Multi-step đã làm, không dùng single checkpoint. [R18] |
| `F-COVERAGE-01` | **[OBSERVED, code + live-model test + real-engagement audit 2026-10-13, confirmed nhưng đóng]** Code xác nhận registry 10-class (`VULN_CLASS_REGISTRY`) bỏ sót hoàn toàn: race-condition/business-logic (money transfer) → chỉ ra `authn_jwt`,`authz`; mass assignment → chỉ ra `idor`,`authz`; thiếu rate-limit OTP → chỉ ra `idor`; **file-upload→RCE → trả về RỖNG, 0 class nào**. Live-model test (4 surface × 3 model): 12/12 response tự nêu đúng class mà registry bỏ sót. **Nhưng audit §3.1.3 trên 6 engagement thật cho thấy registry không phải thứ duy nhất model có thể dùng**: đường free-form thật (role `exploit` chung) được dẫn bởi router skill `exploit/web/SKILL.md` — **27 kỹ thuật**, đã có sẵn `mass-assignment`, `race-condition`, `business-logic`, `file-upload` (đúng 4 thứ registry thiếu). Trong engagement khó nhất quan sát được (silentium), model còn tự nghĩ ra chuỗi khai thác (TypeORM operator injection, JWT-forge+race condition, Socket.IO sniffing) **vượt xa cả 27 kỹ thuật này** — không khớp tên bất kỳ skill nào. **Quyết định 2026-10-13: không mở rộng registry, không khôi phục matrix.** Registry 10-class là công cụ hẹp hơn cả 2 thứ đang thật sự chạy (skill router 27-loại + suy luận tự do), nên mở rộng nó không giải quyết gì. | Đóng theo hướng registry. Câu hỏi coverage thật (model có bỏ sót gì so với baseline KHÁC CẢ matrix và registry không) chuyển sang Q13/benchmark hidden-world — xem §3.1.3 và cập nhật Q13. [R14], [R20] |

**[TENTATIVE]** Projection target binding/wording là điều nên điều tra đầu tiên vì failure có thể tái hiện nhỏ, owner rõ, và giải pháp có thể đơn giản hơn subsystem mới. Chưa tuyên bố đã gây mission thất bại hay đã thỏa gate ADR-0049 decision 5. [R1]

#### 3.1.1 Phụ lục (2026-10-13): live-model test cho `F-PROJ-JEWEL-01`/`F-PROJ-SEMANTICS-02`

**[OBSERVED]** Sau khi fix cả hai (PR tại `knowledge/graph/summary.py` +
`tests/unit/middleware/test_kg_summary_unit.py`, verify qua TDD red→green: tạm revert
fix, xác nhận test mới fail đúng kịch bản bug, khôi phục fix, 35/35 test pass, `ruff`+
`basedpyright` sạch), chạy 2 thí nghiệm single-turn (không agentic loop, không tool,
không sandbox/target) qua LiteLLM proxy thật đang chạy sẵn trên máy, dùng 3 model được
cho phép: `custom/zai-org/GLM-5.3-Flash`, `custom/MiniMax/MiniMax-M3`,
`custom/MiniMax/MiniMax-M3-VIP`. Tổng ~18 lệnh gọi model thật, ~4,5 phút gọi API (trong
hạn 1h được cấp).

- **Thí nghiệm 1 (jewel binding):** context pre-fix (buggy, 2 jewel chung route) vs
  post-fix (route riêng), hỏi route cụ thể của `payments_db`. Buggy: 6/6 response trích
  route sai; GLM-5.3-Flash và MiniMax-M3-VIP tự phát hiện mâu thuẫn ("this route appears
  inconsistent on its face — it terminates at domain_admin rather than payments_db"),
  MiniMax-M3 không phát hiện (trả lời chắc chắn route sai, không caveat). Fixed: 6/6
  đúng. Ghi chú kỹ thuật: GLM-5.3-Flash là model "thinking" — gọi với `max_tokens=300`
  khiến `content` rỗng/timeout (dùng hết budget cho `reasoning_content`, cùng cơ chế mà
  `intelligence/llm/factory.py`'s `_ReasoningContentChatOpenAI` đang xử lý ở phần code
  chưa commit khác trong repo); phải tăng `max_tokens=2000` để lấy được `content` thật.
- **Thí nghiệm 2 (wording):** "1 viable path" (cũ) vs "1 graph path" (mới) trong một KG
  state block, hỏi CONFIRMED hay NEEDS-VERIFICATION. 6/6 response ở cả hai wording trả
  lời NEEDS-VERIFICATION — không có khác biệt đo được trong khung hỏi trực tiếp này.

**Kết luận:** hai case cùng dạng "projection sai/mơ hồ" nhưng rủi ro khác hẳn nhau khi đo
thật — sai *fact* (jewel misbinding) gây sai lệch plan đo được trên mọi model đã thử;
đổi *wording đơn thuần* (không kèm sai fact) không đo được tác động trong test này. Không
suy rộng sang khung ambient/multi-turn agentic thật chưa được thử.

#### 3.1.2 Phụ lục (2026-10-13): `F-SHARED-ACTION-01`, `F-COVERAGE-01`, `F-REPLAN-01`

**[OBSERVED]** Cùng 3 model (`custom/zai-org/GLM-5.3-Flash`, `custom/MiniMax/MiniMax-M3`,
`custom/MiniMax/MiniMax-M3-VIP`), không giới hạn thời gian cứng (người dùng đã bỏ cap
1h cho lượt này). Trước khi chạy live-model test, đã tận dụng lại 6 `record.jsonl`
engagement thật (đã dùng ở §3.3.1/Q10) để tìm bằng chứng free — kết quả là phát hiện nền
tảng ghi ở §2.2 (`objective_expand`=0 trong tất cả 6 run).

**Thí nghiệm F-SHARED-ACTION-01 (duplicate recon):** 2 cell giả lập trên cùng
`surface_key` (`sqli` và `idor` trên `/api/orders/{id}`), mô tả task theo đúng template
thật của `_surface_exploit_payload`. Mỗi cell được hỏi độc lập (conversation riêng,
không chia sẻ gì — đúng session isolation thật của ADR-0021) "lệnh bash đầu tiên nhằm
vào target (không phải load skill) là gì". Lần thử đầu bị lỗi thiết kế (hỏi sai — mọi
model trả lời "load skill file", đúng theo template, không phải recon trùng); sửa câu
hỏi để loại trừ bước load skill, chạy lại. Kết quả: **12/12 response** (3 model × 2 cell ×
2 lần lặp) đều đề xuất cùng dạng lệnh (`curl .../api/orders/1` lấy baseline response
shape/status/headers) — xác nhận hai cell độc lập sẽ thực sự tốn 2 lần gọi giống nhau
cho cùng thông tin trên target thật.

**Thí nghiệm F-COVERAGE-01 (registry blind spot):** Trước tiên xác nhận bằng code thật
(`uv`-free, import trực tiếp `_surface_registry.applicable_vuln_classes`, mất ~2 phút do
import kéo theo toàn bộ cây agent/LLM factory): 4 surface tự tạo (`money_transfer`,
`mass_assignment`, `rate_limit_otp`, `file_upload_rce`) qua registry 10-class, kết quả
`(authn_jwt, authz)`, `(idor, authz)`, `(idor,)`, **`()` rỗng** — xác nhận registry bỏ
sót race-condition/business-logic, mass assignment, rate-limit, và đặc biệt bỏ sót
*hoàn toàn* file-upload→RCE. Sau đó cho 3 model xem đúng 4 surface này (JSON thô, không
cho biết registry trả gì), hỏi liệt kê top 8 vuln class cần test. Lần đầu bị cắt do
`max_tokens` quá thấp (model "thinking" dùng hết budget cho `reasoning_content`, giống
vấn đề đã gặp ở §3.1.1) — sửa bằng cách tăng `max_tokens=3000` + fallback đọc
`reasoning_content`. Kết quả: **12/12 response** (4 surface × 3 model) tự nêu đúng class
mà registry bỏ sót, luôn ở nhóm ưu tiên cao nhất.

**Thí nghiệm F-REPLAN-01 (contradiction → replan, multi-turn thật):** 2 checkpoint
trong CÙNG MỘT conversation (không phải 1 checkpoint đơn — đúng yêu cầu của tài liệu ở
§3.2/Q11). Checkpoint 1: model nhận H1 (SQLi ở `/login`, bằng chứng = lỗi 500 "SQL
syntax error" khi gửi dấu nháy đơn), phải nêu outcome/next_action (đúng vocabulary của
`benchmarks.suites.decision_eval`) và follow-up phụ thuộc nếu H1 đúng. Checkpoint 2
(append câu trả lời của model vào history, thêm turn mới): evidence mới — test
boolean true/false cho kết quả giống nhau, VÀ lỗi 500 giống hệt xảy ra trên field
không liên quan SQL (`search`) — bác bỏ precondition của H1 (đây là WAF generic, không
phải SQL injection thật). Hỏi lại outcome/next_action và follow-up có nên tiếp tục.
Kết quả: 3 model × 2 lần lặp = 6 lượt turn-2; 1 lượt (GLM rep0) timeout hạ tầng (giữ
trong mẫu số, không coi là evidence). **5/5 lượt hoàn thành đều tự nhận `contradicted` +
`revise_hypothesis`/`stop_insufficient`, và chủ động nêu rõ follow-up phụ thuộc phải bị
hủy/sửa**, không có lượt nào mù quáng tiếp tục kế hoạch cũ.

**Kết luận chung §3.1.2:** 2/3 case xác nhận là rủi ro kiến trúc thật (đo được ở tầng
model, chưa đo qua dispatch/sandbox thật) nhưng đều phụ thuộc vào một pipeline
(coverage-matrix) hiện không hoạt động trong production thật — nên là rủi ro *latent*,
không phải *active*. Case thứ 3 (`F-REPLAN-01`) không xác nhận được failure: model, khi
được đưa evidence mâu thuẫn rõ ràng, tự replan đúng 100% (5/5) các lượt hoàn thành —
nghi vấn ban đầu về khả năng replan của baseline hiện không có cơ sở thực nghiệm để giữ
như một named-failure riêng của OPPLAN/model; nếu có vấn đề thật, nó nằm ở việc hệ thống
có đưa evidence mâu thuẫn đến đúng checkpoint hay không (context-engineering), không
phải ở năng lực model.

#### 3.1.3 Phụ lục (2026-10-13): audit coverage thật trên 6 engagement — quyết định đóng hướng coverage-matrix

**[OBSERVED]** Để chốt hướng giữa "khôi phục coverage-matrix" vs "công nhận free-form là
baseline" (câu hỏi mở từ §2.2), đối chiếu lại trực tiếp từng engagement: nội dung
`recon/SUMMARY.md` thật (cái model THẤY) so với `load_skill` nào thực sự được gọi và
`task()` nào được dispatch (cái model LÀM). Không cần chạy LLM thêm — chỉ đọc lại 6
`record.jsonl` đã có.

**4/6 run** (`silentium-smoke` + 3 bản `htb/*_silentium-smoke`) là smoke-test bị giới hạn
chủ động: `roe.json` cấm `-sV`/`-sC`/vuln-scan/brute-force, chỉ quét 2 port. Dừng ở recon,
0 lần dispatch exploit — không phải bỏ sót, vì các run này không được phép đi xa hơn.
Không dùng được làm bằng chứng coverage theo chiều nào.

**`reddish`** (1 lần dispatch exploit): recon tìm 1 port mở (Node-RED dashboard không auth).
Model load đúng `exploit/web/SKILL.md` → `exploit/web/cve/SKILL.md`, dispatch 1 lần →
báo cáo cuối: 5/5 objective hoàn thành, 4 critical finding, "100% attack success". Ca đơn
giản, không có bề mặt mơ hồ cần hệ thống hóa — free-form xử lý gọn, không thấy dấu hiệu
thiếu.

**`silentium`** (36 lần dispatch — ca khó nhất quan sát được): `recon/SUMMARY.md` trên
domain chính gần như rỗng — trang tĩnh, không form, mọi path lạ trả về y trang chủ
(catch-all giả 404). Model vẫn tiếp tục, tìm ra subdomain `staging.silentium.htb`
(Flowise 3.0.5, không xuất hiện trong SUMMARY.md đã trích) và tự xây một chuỗi nhiều
bước: dò `chatflowId` → **TypeORM operator injection** qua endpoint lookup file → JWT
default-secret forgery + race condition khi đăng ký → Socket.IO event sniffing → RCE
trong container → pivot sang host qua SSH → khai thác tiếp Gogs. **Không bước nào trong
chuỗi này khớp tên với 1 trong 10 class của registry HAY 1 trong 27 kỹ thuật của skill
router** — model tự nghĩ, tự đặt tên, tự chain.

Một khoảnh khắc đáng ghi: model từng thử dùng role `surface_exploit` có cấu trúc, tự đặt
`vuln_class="CVE/unauth-API-abuse"`, cố `load_skill("/skills/standard/surface_exploit/CVE/unauth-API-abuse/SKILL.md")`
— đường dẫn này **không tồn tại** (đã xác nhận bằng `find`: kho `surface_exploit/` chỉ có
đúng 10 thư mục cố định: `authn_jwt, authz, graphql, idor, open_redirect, sqli, ssrf,
ssti, xss, xxe`). Model tự phục hồi bằng cách load 2 skill có sẵn gần nhất (`authz`,
`idor`) rồi tiếp tục bằng suy luận riêng — không bị kẹt, nhưng cũng không có "sách" nào
thực sự khớp với lỗi vừa tìm ra.

Đối chiếu thêm: router skill `exploit/web/SKILL.md` (dùng bởi role `exploit` chung, tức
đường free-form thật) có **27 kỹ thuật**, trong đó đã có sẵn `mass-assignment`,
`race-condition`, `business-logic`, `file-upload` — đúng 4 thứ mà registry 10-class của
matrix (`F-COVERAGE-01`) bị xác nhận bỏ sót. Nghĩa là registry không phải "sách duy nhất"
model có thể dùng; nó hẹp hơn CẢ HAI thứ đang thật sự chạy (skill router 27-loại + suy
luận tự do vượt khỏi cả 27 loại đó, như chuỗi TypeORM/Socket.IO ở trên).

**Giới hạn của audit này (quan trọng):** không thể biết từ log liệu `silentium` có bỏ sót
gì ở domain chính hay không (ví dụ SQLi/XSS chưa thử) vì model đã "thắng" sớm với chuỗi
Flowise RCE và không quay lại — bản chất của một hypothesis "chưa từng được biểu diễn"
là nó không để lại dấu vết để audit tìm thấy. Đây chính xác là giới hạn nhận thức đã nêu
ở Q13 — không trả lời được bằng cách đọc log, chỉ trả lời được bằng benchmark có đáp án
giấu từ trước (hidden-world, §6.2).

**Quyết định (2026-10-13):**
1. **Không khôi phục coverage-matrix (ADR-0023/0026).** `F-SHARED-ACTION-01` và
   `F-COVERAGE-01` đóng — xem cập nhật tại chỗ ở bảng §3.1. Lý do: dữ liệu thật cho thấy
   free-form (qua skill router 27-loại + suy luận vượt khỏi cả skill router) đang tạo ra
   kết quả tốt hơn matrix 10-class trên ca khó nhất quan sát được; ép về matrix sẽ làm
   hệ thống **kém đi** trên đúng loại phát hiện giá trị nhất.
2. **Không đầu tư mở rộng registry/skill thêm** — vì bằng chứng cho thấy baseline free-form
   đã tự vượt xa danh sách 27 kỹ thuật hiện có; thêm vài tên loại lỗi nữa vào danh sách
   không giải quyết vấn đề "liệu còn bỏ sót gì ngoài danh sách không" — đó là bản chất của
   free-form, không phải lỗi thiếu danh mục.
3. **Coverage thật (Q13) chuyển hẳn sang hướng benchmark hidden-world** (§6.2) — đây là
   cách duy nhất ra được một con số đo được cho "tỷ lệ bỏ sót", thay vì tiếp tục suy diễn
   từ log các engagement đã biết đáp án.
4. **Tùy chọn bổ sung, phạm vi riêng, CHƯA quyết định làm:** một tầng "sàn cứng" bằng tool
   quét tự động (nuclei/CVE-fingerprint, default-creds, header/TLS misconfig, dò file/dir
   lộ, fuzz injection cơ bản trên mọi tham số, kiểm rate-limit) chạy **mặc định, không phụ
   thuộc model có nghĩ ra hay không** — khác matrix (matrix ép model CHỈ chọn trong 10
   class; sàn cứng CHẠY SONG SONG với free-form, không giới hạn free-form). Hiện **không
   có bước nào trong hệ thống chạy mặc định như vậy** — ngay cả `nmap` ở recon cũng do
   model tự quyết định gọi theo skill, không phải pipeline cứng. Đây là scope riêng,
   không phải phần của quyết định 1–3 ở trên, cần đánh giá độc lập nếu muốn làm.

### 3.2 Phân biệt bottleneck bằng chain of evidence

| Lớp lỗi | Dấu hiệu cần thu | Phép thử phân biệt |
|---|---|---|
| Exploration | Cơ hội expert/simulator biết nhưng candidate chưa được đề xuất | Giữ budget/tool/context, đổi hypothesis guidance; trace đơn thuần không thấy hypothesis chưa tồn tại. [R3] |
| Reasoning | Relevant evidence đã đến và model thấy, nhưng verdict/ranking/replan sai | Replay đúng decision window; không chỉ đếm tool envelopes. |
| Projection/dependency | Evidence có ở owner nhưng query/truncation/summary bỏ hoặc diễn giải sai precondition | Chụp owner snapshot → projection → input model; thử projection fix với policy giữ nguyên. |
| Dispatch | Candidate hợp lệ đã xét/selected nhưng queue delay, dedup/rejection hoặc ledger state ngăn launch | Timestamps considered/selected/requested/started, reason code và queue depth. |
| Execution | Đã launch nhưng tool unavailable, adapter/parser fail, timeout/target drift | Executor status, artifact, parser version, partial result; giữ policy, sửa execution seam. |
| Context | Evidence đúng bị masking/compaction/cross-child leakage hoặc payload quá dài | So effective prompt hashes, kept/dropped refs và child isolation trên cùng trace. |

**[PROPOSED]** Một failure packet gồm case ID, goal, authorized initial state, expected observable behavior, timeline, raw artifacts/provenance, budget loss, code version và cách đơn giản nhất đã thử. Gắn causal classification với uncertainty; một episode có thể có nhiều lỗi, không ép một nguyên nhân khi evidence thiếu.

#### 3.2.1 Phụ lục Q02 (2026-10-13): phân rã critical-path thật trên 2 engagement lớn

**[OBSERVED]** Dùng lại `ts`/`dur_ms` sẵn có trong `record.jsonl` (không gọi LLM thêm) để
phân rã theo đúng yêu cầu §1.3 ("tách control-plane/startup/queue, model generation,
context retrieval, execution, verification, reporting"). Loại các entry `task` ra khỏi
tổng khi tính tỷ lệ primitive — `task` là vỏ bọc chờ sub-agent con xong, `dur_ms` của nó
*lồng chứa* toàn bộ model_call/tool_call bên trong, cộng chung sẽ đếm trùng.

| Run | Wall-clock | model_call (primitive) | bash (primitive) | KG/OPPLAN/skill/file-IO (gộp) |
|---|---|---|---|---|
| `silentium` | 314 phút | 210.6 phút (**67%** primitive) | 101.1 phút (32%) | <2 phút (<1%) |
| `reddish` | 153 phút | 46.1 phút (32%) | 98.5 phút (**68%**) | <0.1 phút (~0%) |

Hai kết luận trực tiếp:
1. **KG/OPPLAN/skill-loading overhead không phải bottleneck** — gộp tất cả (`kg_record`,
   `update_objective`, `add_objective`, `load_skill`, `read_file`, `write_file`, `grep`,
   `ls`...) chưa tới 1% tổng thời gian ở cả 2 run, dù `load_skill` gọi 23 lần ở silentium.
   Mọi lo ngại về chi phí truy vấn KG/OPPLAN trong §1.3 không khớp với data thật.
2. **Tỷ trọng model-think vs bash-execution ĐẢO NGƯỢC giữa 2 run** (67%/32% vs 32%/68%)
   — không có một bottleneck cố định; phụ thuộc đặc điểm target cụ thể (silentium: nhiều
   suy luận/chain phức tạp trên 1 app; reddish: ít suy luận hơn nhưng tốn thời gian quét).

**Phát hiện cụ thể nhất — đáng kể hơn cả 2 số trên:** 10 entry chậm nhất ở mỗi run đều là
`task` (toàn bộ 1 lần dispatch sub-agent), không phải 1 lệnh bash/model đơn lẻ nào — lệnh
bash chậm nhất ở reddish chỉ 68s, nhưng 1 dispatch `recon` nguyên lần chạy **3436s (57,3
phút)**. Truy ngược: đây là dispatch recon cho "Full TCP port scan of 10.129.13.196 (all
65535 ports)" — và nó là **lần quét full-range THỨ HAI** (lần đầu, seq 827, cũng
1290s ≈ 21,5 phút, cho kết quả rỗng mâu thuẫn với 1 lần quét trước đó, nên model tự quyết
định quét lại toàn range để xác minh). **Hai lần full-port-scan này gộp lại chiếm 78,4
phút / 153 phút wall-clock = 51% tổng thời gian của CẢ engagement** — chỉ riêng việc quét
lại cổng (không phải suy luận, không phải KG, không phải OPPLAN) đã ăn hơn một nửa thời
gian toàn bộ cuộc engagement.

**Kết luận Q02 (nâng cấp từ [OPEN], vẫn chưa đóng hoàn toàn):** với 2 engagement thật này,
đòn bẩy yield-per-time lớn nhất không nằm ở model reasoning, không nằm ở KG/OPPLAN
overhead (đã loại trừ bằng số) — mà ở **recon tự lặp lại 1 scan tốn kém** khi kết quả có
vẻ mâu thuẫn, không có cơ chế cache/ghi nhớ "đã quét full-range rồi, chỉ cần quét lại phần
khả nghi" (một dạng F-SHARED-ACTION-01 nhưng ở recon-recon, không phải cell-cell). Chưa đủ
dữ liệu (2 engagement) để tổng quát hóa thành kết luận hệ thống; cần thêm engagement thật
có full-scan recon để xác nhận pattern này có lặp lại không trước khi coi là named-failure
đủ điều kiện mở PR theo gate G1. [R9], [R27]

Nếu lặp lại ở engagement khác: ứng viên fix là cache phạm vi đã quét + chỉ re-scan phần
dải cổng có tín hiệu mâu thuẫn, không full-range lại từ đầu — nhỏ, không đụng guard rail,
tương tự tinh thần fix `F-PROJ-JEWEL-01`.

### 3.3 Sổ câu hỏi nghiên cứu và câu trả lời hiện tại

Đây là danh sách cần chốt trước quyết định runtime P4. “Chưa biết” là một câu trả lời hợp lệ khi kèm phép thử có thể bác bỏ giả thuyết; không điền kết luận bằng trực giác.

| ID | Câu hỏi cần trả lời | Câu trả lời hiện tại / trạng thái | Cách chốt |
|---|---|---|---|
| Q01 | Tối ưu cái gì và đánh đổi nào được chấp nhận? | **[LOCKED, duyệt bởi maintainer 2026-10-13, tạm thời]** Verified mission yield trong budget, đọc cùng coverage/cost/latency. Trọng số goal: dùng thứ tự ưu tiên ghi trong RoE/ConOps nếu có; nếu không, **trọng số bằng nhau**. | Đã khóa. Được sửa trước lần đánh giá tiếp theo nếu có lý do (ví dụ RoE cụ thể ghi priority khác); không được sửa SAU khi đã thấy kết quả 1 đánh giá để đổi verdict của chính nó. |
| Q02 | Bottleneck mất yield nhiều nhất nằm ở đâu? | **[OBSERVED một phần, 2026-10-13]** P3 xác nhận citation/reasoning failures; chưa xác định bottleneck whole-system qua P3. Nhưng phân rã critical-path thật trên 2 engagement (§3.2.1, dùng lại data có sẵn, không gọi LLM) cho 3 kết luận cụ thể: (1) KG/OPPLAN/skill-load overhead **không** phải bottleneck (<1% tổng thời gian, loại trừ bằng số, không phải giả định); (2) tỷ trọng model-think vs bash-execution đảo ngược hoàn toàn giữa 2 run (67/32 vs 32/68) — không có 1 bottleneck cố định cho whole-system; (3) phát hiện cụ thể nhất: recon tự lặp lại 1 full-port-scan tốn kém (51% tổng thời gian 1 engagement) khi kết quả mâu thuẫn — ứng viên named-failure thật nhưng mới có n=1, cần thêm engagement để xác nhận lặp lại. | Đã làm phần rẻ (dùng data sẵn có). Phần còn thiếu: (3) cần thêm engagement thật có full-scan recon để xác nhận pattern lặp lại trước khi mở G1; phần critical-path full-stack (control-plane/queue/verification/reporting riêng) vẫn cần instrument thêm, 2 run hiện tại chỉ có model_call/tool_call, chưa tách được các giai đoạn khác. |
| Q03 | OPPLAN/dispatch hiện tại thật sự thiếu năng lực gì? | **[OBSERVED, đã chốt 2026-10-13]** Không phải OPPLAN/dispatch tự thân thiếu năng lực. Subsystem coverage-matrix (ADR-0023/0026) **không được invoke trong production** (0/6 `objective_expand`, §2.2) — và audit §3.1.3 xác nhận đây không phải thiếu sót: free-form (skill router 27-loại + suy luận vượt khỏi cả router) đang cho kết quả tốt hơn matrix trên ca khó nhất quan sát được. **Quyết định: công nhận free-form là baseline chính thức, không khôi phục matrix.** [R1], [R10], [R19] | Đã chốt. Không scope lại OPPLAN/dispatch cho matrix nữa; câu hỏi còn lại là coverage đo được (→ Q13, hidden-world benchmark). |
| Q04 | Cần projection mới hay sửa query/context hiện có? | **[OBSERVED, đã chốt 2026-10-13]** Sửa query hiện có là đủ — không cần projection/AttackState mới. `F-PROJ-JEWEL-01` tái hiện (TDD red→green) + fix 1 dòng Cypher (+`c.key` binding) + xác nhận tác động hành vi thật trên 3 model sống (6/6 misled pre-fix, 6/6 correct post-fix, xem §3.1.1). `F-PROJ-SEMANTICS-02` sửa wording, live-test không thấy tác động đo được cần sửa sâu hơn ở query. [R20], [R22] | Đã chốt cho 2 case này; không mở rộng sang projection mới trừ khi có named-failure khác không giải được bằng sửa query. |
| Q05 | Action/hypothesis identity và dedup nên là gì? | **[OBSERVED, đóng 2026-10-13]** `F-SHARED-ACTION-01` xác nhận live-model (12/12): 2 cell cùng surface, khác vuln_class, độc lập đề xuất cùng baseline probe — trùng lặp thật nếu dispatch qua pipeline matrix. Nhưng matrix đã quyết định không khôi phục (§3.1.3) — free-form baseline không có cell identity cố định để mà dedup theo, nên câu hỏi này không còn cấp bách. [R14], [R19] | Đóng cùng quyết định matrix. Chỉ mở lại nếu có quyết định riêng, sau này, khôi phục pipeline matrix. |
| Q06 | Planner đọc gì, state nào có authority? | **[OBSERVED]** OPPLAN, KG, artifacts và dispatch/session có owners riêng; projection là dẫn xuất. [R28] | Chốt input/output contract và owner theo §5. |
| Q07 | Horizontal/vertical có quyết định breadth/depth hoặc concurrency không? | **[OBSERVED, đóng bằng code 2026-10-13]** Không — và mạnh hơn giả thuyết ban đầu: hiện tại **không có mã nào đọc nhãn horizontal/vertical để quyết định gì cả**. Đọc `postexploit.md` + `plugins/active-directory/.../ad_operator.md`: cả hai role chạy như 1 sub-agent duy nhất, tự lặp tuần tự qua các bước/lane nội bộ (credential→escalation→lateral movement→repeat cho postexploit; 6 lane A-F cho ad_operator) trong CÙNG một dispatch/session. Cơ chế concurrency duy nhất trong toàn hệ thống (ADR-0026, fixed-3 cho `surface_exploit`) không liên quan gì tới lateral/vertical. Ba trục (horizontal/vertical, breadth/depth, concurrency) độc lập đúng như giả thuyết — nhưng vì axis thứ nhất chưa được operationalize ở bất kỳ đâu, không phải vì có safeguard nào tách chúng ra. [R2], [R3] **Khuyến nghị bổ sung 2026-10-13: chủ động KHÔNG xây mechanism này**, không chỉ vì chưa cần mà vì chính epistemic-core document gốc (nguồn của Q07, [R3]) đã tự cảnh báo rủi ro cụ thể — "không tạo hai loại agent horizontal/vertical", "không dùng nhãn transition để bỏ qua authorization/UKC eligibility", "cùng host/cùng mức quyền nhưng đổi identity không nên bị ép thành privilege escalation" (ranh giới phân loại mơ hồ, dễ sai). Thêm trục runtime mới ở đây là over-engineering theo đúng gate ADR-0049 (không build khi chưa chứng minh nhu cầu, và ở đây còn có cảnh báo rủi ro cụ thể đi kèm — không chỉ "chưa cần" mà "có lý do để không nên"). | **Đóng dứt điểm, khuyến nghị không mở lại trừ khi có named-failure mới**. Khái niệm horizontal/vertical vẫn có giá trị ở tầng khác — mô tả/báo cáo (MITRE ATT&CK tách riêng Lateral Movement TA0008 / Privilege Escalation TA0004; hệ thống đã có `mitre_attack` tag trên skill và yêu cầu "Document the full chain" trong `postexploit.md`) — giữ ở tầng đó, không nâng lên thành input cho concurrency/budget. |
| Q08 | Ranking nào đáng thử trước frontier phức tạp? | **[OBSERVED, blocked có lý do rõ, 2026-10-13]** Không có ranking system riêng nào tồn tại để so sánh — `priority` hiện là field model tự đặt tự do khi tạo objective, không qua công thức/heuristic nào. Không phải "chưa test" mà "chưa có 2 cái để so" — H1 (heuristic cost/evidence-gap/coverage) chưa được viết. Đúng theo ADR-0049 decision 5: không nên viết H1 trước khi có named-failure từ B0 cho thấy priority-order không đủ. | Giữ nguyên blocked. Chỉ mở khi: (a) có failure packet thật cho thấy current priority-order dẫn tới chọn sai, VÀ (b) đã qua G1. Không viết H1 "để có cái so sánh" — đó là lý do xây trước khi cần mà ADR-0049 từ chối. |
| Q09 | Uncertainty/cost/risk có được hiệu chỉnh chưa? | **[OBSERVED, mạnh hơn [OPEN] ban đầu, 2026-10-13]** Không chỉ "chưa calibrate" — **chưa có tín hiệu biến thiên nào để calibrate**. `raptix_core/types/capability.py:390`: `confidence: float = 1.0` là default. Grep toàn bộ construction site thật của `Observation(...)` (`knowledge/ingest/parsers/_shared.py:62,67` — nơi parser thật tạo observation): **không site nào truyền `confidence` khác default**. `knowledge/ingest/registry.py:223-229` chỉ forward lại `observation.confidence` không đổi (stamp thêm `source_artifact_id`/`parser_id`, theo đúng ADR-0049 decision 7 đã đọc trước đây). Kết quả: **mọi Observation thật trong hệ thống hiện mang confidence=1.0 cố định**, không phân biệt evidence mạnh/yếu. Một calibration experiment (đo xem confidence có khớp tỷ lệ đúng thật không) trên 1 hằng số là vô nghĩa về thống kê — không phải thiếu thực nghiệm, là thiếu input cho thực nghiệm. [R25], [E4] | Nếu muốn dùng confidence cho quyết định (ranking, stop-vs-continue...): phải có ít nhất 1 parser thật tính confidence biến thiên theo evidence (ví dụ dựa trên số lượng probe đồng thuận, độ mạnh oracle) TRƯỚC — chưa nên thiết kế calibration protocol khi chưa có cái để calibrate. Thu distributions/outcomes theo family vẫn đúng hướng, nhưng bước 0 là "làm cho confidence thật sự khác 1.0 ở đâu đó" trước. |
| Q10 | Fan-out có cải thiện yield hay chỉ tăng compute? | **[OBSERVED, 2026-10-13, từ 6 record.jsonl engagement thật] + [OPEN]** Parse toàn bộ `kind=="tool_call" AND request.tool=="task"` entries từ 6 file ghi nhận thật (`RecordingMiddleware`) đang có sẵn trên máy: `benchmarks/results/runs/{silentium,reddish,htb/*}` + `.raptix/workspace/silentium-smoke` — tổng **51 lần dispatch `task`** trong các engagement HTB thật đã chạy (10/10/2026). Lọc theo `args.subagent_type`: `exploit`=23, `recon`=11, `postexploit`=8, `analyst`=2, **`surface_exploit`=1 (chỉ một lần, trong toàn bộ 6 run)**. Sweep-line trên khoảng `[ts−dur_ms, ts]`: có overlap thật giữa các role khác (`exploit`/`recon`/`postexploit`, max concurrency quan sát = 2, 5 cặp overlap trong run `silentium`) — nhưng **surface_exploit max concurrency quan sát = 1, 0 cặp overlap** vì chỉ có đúng 1 lần dispatch. → Cơ chế fan-out bị cap bởi ADR-0026 (`max_in_flight=3`) **chưa từng được quan sát chạy với ≥2 cell `surface_exploit` song song trong bất kỳ engagement thật nào ta có dữ liệu** — không phải "chưa đo được launch/overlap" mà là "chưa có episode thật nào kích hoạt đủ cell để fan-out có cơ hội xảy ra". Phần causal (fan-out có tăng yield hay không) vẫn **[OPEN]** — không có control group, và giờ còn thiếu cả data thật để so sánh vì n=1. [R17], [R18] | Trước khi B0 fixed3 vs B1 serial1: cần một engagement thật tạo ra ≥2 `surface_exploit` cell pending đồng thời (coverage matrix đủ lớn) để fan-out có cơ hội kích hoạt — nếu không, so sánh serial/parallel vẫn chỉ là giả định trên giấy. Script phân tích: xem phụ lục cuối Q10. |
| Q11 | Sau contradiction, state đổi hoặc partial result phải replan thế nào? | **[OBSERVED, đã chốt phần model, 2026-10-13]** Multi-step `F-REPLAN-01` đã chạy (2 checkpoint thật, không phải 1): 5/5 lượt hoàn thành model tự nhận contradicted + chủ động hủy/sửa follow-up phụ thuộc. Không xác nhận được failure ở tầng model. Re-evaluate dependent eligibility; inconclusive không tự refute; late result giữ lineage — vẫn đúng như [PROPOSED] ban đầu, giờ có evidence model-level ủng hộ. | Nếu vẫn nghi ngờ: test tiếp ở tầng orchestration thật (model có nhận đúng evidence mâu thuẫn tại checkpoint OPPLAN thật không), không phải ở reasoning. |
| Q12 | Khi nào nên dừng để tối ưu budget? | **[OBSERVED, live-model test 2026-10-13 — năng lực tốt, nhưng phát hiện gap wiring thật]** Scenario: Objective A đã confirmed (cần ~2 call để verify/write-up), Objective B có lead nhưng 2/3 cách đã thất bại. **Budget hẹp (2 call): 6/6 response** (3 model × 2 lần lặp) chọn đúng — dừng B, dùng 2 call chốt A, lý giải đúng kỹ thuật (LD_PRELOAD bị glibc secure-exec strip trên SUID binary). **Budget rộng (30 call): 6/6 response** chọn hybrid đúng — chốt A trước (bảo hiểm rẻ), rồi thử B có giới hạn (stop-loss), dành phần còn lại cho enumeration khác — không gamble toàn bộ, không bỏ A. → Năng lực model cho việc này **rất tốt khi được cho số budget cụ thể**. **Nhưng kiểm tra lại production thì KHÔNG tìm thấy cơ chế nào cho model biết số budget còn lại**: grep `intelligence/prompts/standard/raptix.md` không có chỗ nào surface "remaining budget: N calls"; đọc lại `middleware/budget.py` (đã đọc ở round trước) xác nhận cảnh báo 70% chỉ là stream event cho **dashboard người vận hành xem**, không vào context model; vượt 100% thì raise `BudgetExceeded` "bubbles up and terminates the run" — **không có lượt cuối cho model chốt việc** như test này cho thấy nó làm rất tốt. Middleware này đang tồn tại thật (không bị khóa bởi subsystem chết như F-SHARED-ACTION-01/F-COVERAGE-01), chỉ mặc định tắt (`ENGAGEMENT_USD` non-positive = no-op). | **[FIXED, 2026-10-13, commit `fc09daa`]** — surface remaining-budget vào system message model trên mọi lệnh gọi vượt `soft_warn` (70%), giọng cấp bách hơn qua `final_warn` mới (90%); hard-stop ở 100% giữ nguyên (không cấp thêm lượt nào qua cap — xem ghi chú ở (2) không làm, chỉ cảnh báo sớm hơn). 50/50 test pass, lint/type sạch. |
| Q13 | Làm sao biết các hypothesis chưa từng được biểu diễn? | **[OPEN, đây là câu hỏi coverage chính sau quyết định 2026-10-13]** Trace không nhìn thấy chúng; cần simulator/expert-defined opportunities. [R3] Audit §3.1.3 trên 6 engagement thật xác nhận: registry 10-class và skill router 27-class đều KHÔNG phải trần năng lực thật — ca khó nhất (`silentium`) model tự nghĩ ra chuỗi khai thác vượt khỏi cả hai danh sách. Nhưng audit cũng xác nhận **không thể biết từ log liệu có bỏ sót gì khác không** — bản chất "chưa biểu diễn" không để lại dấu vết. Đây không còn là vấn đề của registry (đã đóng, xem `F-COVERAGE-01`) — là giới hạn nhận thức cần benchmark riêng mới đo được. | **Quyết định 2026-10-13: đây là hướng ưu tiên tiếp theo cho câu hỏi coverage**, không phải mở rộng registry/skill. Hidden-world evaluation + expert review, denominator chỉ reachable opportunities — xem thiết kế §6.2 (families tối thiểu theo failure mechanism đã có; cần scenario thật + golden state giấu ở evaluator, chưa triển khai). |
| Q14 | Scope, budget và concurrent ownership được bảo đảm ở đâu? | **[OBSERVED, đóng bằng code 2026-10-13, kết quả trộn]** 3 phần, 2 ổn + 1 có gap thật: **(1) Scope/RoE — tốt, defense-in-depth thật.** `middleware/roe.py` tự nhận "guardrail, không phải sole gate" — lớp 1 chặn local trước khi lệnh chạy, lớp 2 độc lập là egress nftables/DNS compiled từ CÙNG `machine_enforcement` rules, nên lệnh lọt qua lớp 1 vẫn không ra được mạng. Hai lớp độc lập thật, không chỉ 1 điểm kiểm duy nhất. **(2) Concurrent ownership — tốt.** `DispatchMiddleware._active` (set+lock) chặn đúng 1 `dispatch_id` chạy 2 lần đồng thời; ADR-0021 B0 cho mỗi cell session bash riêng (đã GO). **(3) Budget — CÓ GAP RACE THẬT, xác nhận bằng đọc code, không cần live-model.** `middleware/budget.py:223-244` (`_check_one`): lock chỉ bảo vệ việc đọc/ghi **cache dùng chung** (tránh fetch trùng + double-fire soft-warn) — không "giữ chỗ" (reserve) chi phí cho các lệnh đang bay. Với N lệnh gọi đồng thời (N=3 từ ADR-0026 fixed-3, hoặc N=2 từ Initial-Foothold parallel intake) trong cùng 1 cửa sổ poll (`RAPTIX_BUDGET__POLL_SECONDS` mặc định 5.0s — ngắn hơn nhiều so với thời gian 1 lệnh model thật chạy, đã đo 5-90s ở các test trước), cả N lệnh đều đọc CÙNG giá trị cache cũ, đều thấy "chưa tới 100%", đều được phép chạy — tổng vượt cap chỉ bị bắt ở lần poll SAU, không phải trước khi xảy ra. "Hard accounting" không hard cho batch đồng thời — là race condition toán học, không phải giả thuyết. [R23] | Scope/concurrent ownership: không cần sửa. **Budget: [FIXED, 2026-10-13, commit `fc09daa`]** — gộp 1 PR với Q12 đúng như dự định. Thêm `_inflight` (đếm lệnh đã admit, chưa hoàn thành, theo scope) + reserve `RESERVE_PER_CALL_PCT` (mặc định 1% cap) cho mỗi lệnh đang bay, release khi lệnh xong. Test race-condition mới xác nhận: 3 lệnh đồng thời đấu vào ngân sách gần hết (90% spent, reserve 30%/lệnh) → tối đa 1 lệnh được admit, không phải cả 3 như trước fix. 50/50 test pass. |
| Q15 | Benchmark nào thực sự trả lời planning quality? | **[PROPOSED]** Multi-step partially observable suite riêng; P3 tiếp tục là checkpoint regression. [R4], [R8] | Specification §6.2, valid routes, no oracle leakage và G0. |
| Q16 | So sánh công bằng và đo uncertainty thế nào? | **[OBSERVED, đã validated một phần, 2026-10-13]** P3 thật đã tự chứng minh pattern này khả thi: pairing per-model/scenario/repetition, scheduling seed ghi lại, timeout/recursion-limit CÙNG mức cho cả 2 condition (xem ADR-0064, `decision_eval` README) — không phải lý thuyết, đã chạy thật 660 episode. §7.2.1 (ngay trên) dùng chính data đó để tính δ_goal — chứng minh thêm rằng pattern pairing này đủ để đo được uncertainty thật (không phải chỉ đo được mean). | Tái dùng đúng pattern P3 (seed ghi lại, pairing per scenario/model/rep, ceiling chung) cho B0/B1/H1/... ở §6.4 — không cần thiết kế protocol mới từ đầu, chỉ cần áp dụng lại. |
| Q17 | Kết quả có chuyển sang target thực/domain khác không? | **[OPEN]** P3 không trả lời operational transfer. | Lab reset/snapshot, artifact proof và G4 theo phạm vi được thử. |
| Q18 | Khi nào triển khai và khi nào giữ baseline? | **[LOCKED, duyệt bởi maintainer 2026-10-13, tạm thời]** Gain thực dụng + uncertainty + invariants + chi phí đủ thuyết phục; baseline thắng/ngang thì giữ baseline. **δ_goal = 10 điểm %**, tính từ nhiễu tự nhiên đo thật trên P3 held-out (xem §7.2.1) — gain đo được nhỏ hơn mức này không được coi là GO. | Đã khóa ở 10pp. Margin cost/latency/false-positive chưa tính — tính khi có đánh giá thật cần tới chúng. Sửa δ_goal chỉ hợp lệ TRƯỚC lần đánh giá kế tiếp, không phải sau khi thấy nó fail/pass. |

### 3.3.1 Phụ lục Q10 (2026-10-13): phân tích offline trên engagement thật

**[OBSERVED]** Script một lần (không commit vào repo — nằm ở scratchpad phiên làm việc,
không phải benchmark suite mới) parse mọi entry `kind=="tool_call" AND
request.tool=="task"` trong 6 file `record.jsonl` đã có sẵn, gitignored, trên máy
(`RecordingMiddleware`, opt-in qua `RAPTIX_RUNTIME__RECORD_PATH`, không bật mặc định) —
không chạy engagement/benchmark mới, không tốn LLM cost. Dựng khoảng `[ts−dur_ms, ts]`
mỗi dispatch, sweep-line tính concurrency, lọc riêng theo `args.subagent_type`.

Kết quả (xác minh lại bằng đọc raw JSON, không chỉ qua script): 51 lần dispatch `task`
trên 6 engagement HTB thật (silentium, reddish, 3 bản silentium-smoke, 1
`.raptix/workspace` smoke) — `exploit`=23, `recon`=11, `postexploit`=8, `analyst`=2,
`surface_exploit`=1. Role `surface_exploit` (role bị cap bởi ADR-0026) xuất hiện **đúng
một lần duy nhất** trong toàn bộ dữ liệu, nên **không có episode thật nào để quan sát
fan-out ≥2 cell**. Các overlap thật quan sát được (max concurrency=2, 5 cặp, trong run
`silentium`) đều là giữa role khác (`exploit`/`recon`/`postexploit`), không liên quan cơ
chế `max_in_flight=3` của `_surface_dispatch.py`. Kết luận: trước khi thiết kế B0/B1 so
sánh serial-vs-fixed3 cho Q10, cần một engagement thật mà coverage matrix sinh ≥2 cell
`surface_exploit` pending cùng lúc — hiện chưa có.

### 3.3.2 Phụ lục Q07 + Q12 (2026-10-13)

**Q07 (đóng bằng code, không cần live-model):** đọc `intelligence/prompts/standard/postexploit.md`
và `plugins/active-directory/raptix_active_directory/prompts/ad_operator.md`. Cả hai role
chạy như một sub-agent duy nhất tự lặp tuần tự qua các bước/lane nội bộ trong CÙNG một
dispatch (postexploit: credential→escalation→lateral movement→repeat; ad_operator: 6 lane
A–F, bao gồm Lane D "Lateral movement from graph"). Không có chỗ nào ở tầng orchestrator
đọc nhãn horizontal/vertical để quyết định breadth/depth/concurrency. Cơ chế concurrency
duy nhất toàn hệ thống (ADR-0026, fixed-3) chỉ dành riêng cho `surface_exploit`, không
liên quan. Ba trục độc lập đúng như [TENTATIVE] ban đầu, nhưng vì trục thứ nhất chưa được
code hóa ở đâu cả — không phải vì có cơ chế tách bạch chủ động.

**Q12 (live-model test, 3 model × 2 điều kiện budget × 2 lần lặp = 12 lệnh gọi):** scenario
giữ cố định (Objective A đã confirmed cần ~2 call để chốt; Objective B có lead, 2/3 cách đã
thất bại, LD_PRELOAD chưa thử), chỉ đổi số budget còn lại (2 vs 30 call), hỏi model dùng
budget thế nào. Kết quả: 6/6 (budget hẹp) chọn đúng dừng B để chốt A; 6/6 (budget rộng) chọn
đúng hybrid (chốt A trước, thử B có stop-loss, dành phần còn lại cho enumeration khác) —
không có response nào chọn sai ở cả 2 điều kiện, và lý giải kỹ thuật đều chính xác (nhận ra
LD_PRELOAD bị glibc secure-exec strip trên SUID binary). Verify thêm bằng đọc lại
`middleware/budget.py` (đã đọc round trước) và grep `raptix.md`: xác nhận production không
có cơ chế surface số budget còn lại vào context model — cảnh báo 70% chỉ là stream event
cho dashboard, vượt 100% raise exception chấm dứt run không có lượt chốt việc cuối. Đối
chiếu 2 record.jsonl lớn: không thấy entry `{"type":"error"}` nào ghi `BudgetExceeded`/
`GraphRecursionError` (có nhắc tới "GraphRecursionError" trong text mô tả dispatch retry
của orchestrator ở silentium — cho thấy orchestrator có tự thích nghi sau khi sub-agent
con crash, nhưng đó là phục hồi sau sự cố, không phải báo trước có chủ đích).

**Kết luận chung Q07+Q12:** cùng một dạng phát hiện như F-REPLAN-01 — năng lực model không
phải bottleneck; nếu có vấn đề thật trong production, nó nằm ở lớp wiring/context-engineering
(có đưa đúng tín hiệu tới đúng lúc không), không phải ở khả năng suy luận. Khác với
F-SHARED-ACTION-01/F-COVERAGE-01 (phụ thuộc subsystem không ai dùng), gap của Q12 nằm trên
middleware đang tồn tại thật (`BudgetEnforcementMiddleware`, chỉ mặc định tắt) — nên đây là
ứng viên fix có scope rõ, nhỏ, không cần quyết định kiến trúc lớn trước.

## 4. Giả thuyết và phương án kỹ thuật

### 4.1 Frontier/projection/fan-out có thực sự cần?

| Phương án [PROPOSED] | Chỉ mở khi | Ưu tiên thử trước |
|---|---|---|
| Relevant context / skill guidance | Evidence hoặc applicability không đến đúng decision | Query binding, bounded context, prompt/skill contract, typed failure visibility |
| Evidence-aware replan trong OPPLAN | Model tiếp tục hướng bị bác dù thấy evidence | Checkpoint “continue/revise/gather/stop” cùng owner hiện tại |
| Shared action cache / dedup | Thực thi trùng giữa hypotheses được đo rõ | Identity/result lookup nhỏ, không thêm graph Action nodes |
| Read-only projection refinement | Có route/dependency sai mà query hiện tại không biểu đạt đủ | Mở rộng `summary.py`/`operational_state.py`, không state owner thứ hai |
| Frontier ranking | Candidate hợp lệ cạnh tranh ngân sách; priority/heuristic đơn giản còn thất bại | Prototype offline action ranking trên chính failure packet |
| Dynamic fan-out | Queue/idle time là bottleneck và independence/isolation đã xác minh | So serial1 với fixed3; adaptive chỉ chọn 1–3, không nâng cap |

**[TENTATIVE]** Sửa lỗi execution/context có thể mang nhiều yield hơn policy mới. Frontier giải quyết phân bổ work đã biểu diễn; nó không tự sinh hypothesis mới. Fan-out tăng throughput chỉ khi work độc lập và executor chịu được tải; nó không thay verification. [R2], [R3], [R17]

### 4.2 Identity và dữ liệu dùng chung

**[OBSERVED]** Shapes/seams có sẵn: objective ID/priority/blocked_by/notes; Endpoint/Parameter/Form/AuthModel/Technology; cell ID và session; contracts ExecutionRecord/Artifact/Observation; verification refs/invocations; dispatch ledger và observational tried-edge ledger. Chúng khác scope/lifecycle; có contract không chứng minh mọi execution path đã tạo artifact thật. Inventory state là survey cần đối chiếu code, không migration mandate. [R7], [R10], [R13], [R14], [R19], [R24], [R25], [R33]

**[OPEN]** Chưa thấy trong các seams đã đọc một frontier action identity thống nhất, action→hypotheses mapping đầy đủ, calibrated outcome likelihoods, hoặc resource reservation toàn engagement. Không suy ra rằng mọi plugin đều thiếu chúng; phải inventory assembled profile trước mở interface.

**[PROPOSED]** Nếu shared-action case đạt gate, candidate key phải chứa engagement/scope, normalized operation/surface, identity/auth context, implementation semantics, parameter digest đã khử secret, relevant state/version và verification intent. Không dedup chỉ theo URL, prose hay content hash; khác credential/precondition/target revision có thể là action khác.

Một candidate action có thể nối tới nhiều hypotheses; một hypothesis có nhiều actions. Execution identity tách candidate identity; retry tạo producing invocation mới. Result reuse chỉ khi điều kiện áp dụng/freshness còn hợp lệ, các consumer cùng scope và evidence binding được bảo toàn. Giá trị action được tính một lần, không nhân theo số bản sao hypothesis. [R3], [R7]

Tried-edge `success` dựa exit code zero là kết quả thao tác, không proof của security claim; ledger này observational và không veto action. Dispatch `success` cũng không bằng verified mission success. Giữ ba tầng semantics riêng. [R19], [R24]

### 4.3 Horizontal/vertical, breadth/depth và parallelism

**[TENTATIVE]** Horizontal/vertical/cross-identity là nhãn suy từ security-state transition đã kiểm chứng: asset, identity, privilege, capability trước/sau. Breadth/depth là cách chia budget giữa nhánh và chuỗi dependency; concurrency là số execution cùng chạy. Ba trục có thể tương tác theo mission, nhưng không đồng nhất. [R2], [R3]

Ví dụ cùng host/cùng mức quyền nhưng đổi identity không nên bị ép thành privilege escalation; broad exploration có thể chạy serial, deep chain có thể có nhiều bước thu evidence độc lập song song. Không tạo hai loại agent horizontal/vertical hoặc dùng nhãn transition để bỏ qua authorization/UKC eligibility. [R3], [R25]

### 4.4 Uncertainty, cost và risk

**[OBSERVED]** `Observation.confidence` là float với range check; `RiskClass` là tier; không có calibration experiment trong nguồn đọc. Range `[0,1]` không chứng minh xác suất đúng. Paper calibration định nghĩa xác suất đại diện likelihood correctness, nhưng thí nghiệm của nó là image/document classifiers, không Raptix. [R25], [E4]

**[PROPOSED]** V1 dùng lexicographic/simple heuristic: mission relevance → precondition/evidence gap → unseen invariant trong coverage budget → estimated cost tier → deterministic tie-break. Ghi feature/reason; gọi là heuristic ranking, không Bayesian IG hoặc optimal policy. Tune trên dev; không khóa một công thức entropy chưa có observation model. [R3]

Nếu cần xác suất, thu outcomes theo action family và điều kiện quan sát, đánh giá calibration/reliability và proper scoring trên dữ liệu mới; cost dùng distribution/quantile từ executor thật, gồm timeout/retry. Sparse families giữ `unknown`, không biến model tự tin thành precision giả. Impact tier là constraint; phần risk còn lại có thể tie-break, không mua quyền vượt scope.

Chống coverage starvation bằng ngân sách exploration/coverage riêng hoặc minimum coverage constraint theo mission; quota/floor là tham số [PROPOSED] phải chọn trên dev trước holdout. Không cộng CoverageGain với IG khi chưa chứng minh tín hiệu không trùng lặp. [R3]

### 4.5 Eligibility, launch, stop và refutation

**[PROPOSED]** Pipeline: kiểm availability → state/dependency eligibility → pre-filter scope/RoE/approval/impact/budget → ranking → reserve budget/conflict-free launch → authoritative invocation guard kiểm lại. Một approval đang thiếu là pending authorization, không runnable. Exposure hoặc projection không cấp quyền. [R25], [R26]

Giữ cap hiện hành 3; serial1 là đối chứng thận trọng. Width của candidate set có thể lớn hơn 3 nhưng chỉ launch batch có độc lập state/resource, session và output namespace riêng. OPPLAN accounting/generation vẫn tuần tự; prompt cap không thay semaphore/resource ceiling có thể đo. [R17], [R18], [R19]

**[PROPOSED]** Replan khi evidence mâu thuẫn, target/auth state đổi, dependency bị bác, action không thêm information, budget/health đổi. Refutation chỉ phủ định claim trong điều kiện đã thử; infra timeout/parse fail là inconclusive, không negative proof. Re-evaluate downstream eligibility trước launch tiếp; late results giữ lineage nhưng không ghi đè state mới.

Dừng khi mission đã đủ proof, không còn action được phép/khả thi, budget không đủ cả execution+verification+close-out, hoặc no-progress rule đã khóa trước chạy. Với missing evidence và còn budget thì gather; hết budget thì stop-insufficient. Retry infra bounded, đổi intent khi đổi strategy, không tự mở lại terminal dispatch. Đây là stopping heuristic, chưa chứng minh budget-optimal. [R18], [R19], [R25]

## 5. Phạm vi thay đổi và ownership

| State / trách nhiệm | Owner hiện tại và seam đề xuất |
|---|---|
| Mission/objective lifecycle | `orchestration/mission/opplan.py` + OPPLAN tools/state; projection không tự sửa objectives. [R10], [R12] |
| Recorded semantic claims | `knowledge/graph/` + Neo4j, engagement-scoped; claim hiện diện không đồng nghĩa verified. [R7], [R21] |
| Normalized observations/raw artifacts | Core contracts; normalization ở `knowledge/ingest/`, execution ở `execution/`; không Observation model thứ hai. [R1], [R25], [R26] |
| Reachability/planning view | Bounded read-only derivation tại `knowledge/graph/summary.py`/`operational_state.py`; ghi revision/source/limitations, rebuild/discard được. [R20], [R22] |
| Dispatch outcome/session/replay | Existing dispatch/streaming và `execution/session/`; không coi resume là exactly-once target effects. [R19], [R27] |
| Domain guidance | Plugins/skill corpus theo ownership; policy framework thuộc runtime, offline study thuộc `benchmarks/`. [R28], [R29] |

**[PROPOSED]** Projection trả recorded claim/evidence refs, preconditions, freshness và missing fields; không biến HAS_SESSION thành live session, shortest semantic path thành authorization, hay snapshot thành current verification. Authoritative reads/checks luôn ở owner; cache invalidation có revision và explicit unknown/degraded trạng thái. [R7], [R20], [R22]

LangGraph reducers xử lý update channels, `Send` cho map-reduce với state từng nhánh; chúng là cơ chế execution, không xác nhận independent evidence hay đồng bộ canonical KG. Parent-shared writes cần reducer đúng; external side effects khi retry/resume vẫn cần idempotency. Không parallelize OPPLAN chỉ vì framework hỗ trợ parallel nodes. [E1], [E2], [R10]

**[PROPOSED]** Mỗi runtime tranche một concern, ≤400 runtime lines / ≤10 files; public API/subsystem boundary mới cần Proposed ADR trước. Core API đổi phải cập nhật stability manifest và CHANGELOG; SDK/plugins không import runtime internals; middleware chỉ cross-cutting adapter. Không gộp đổi exposure, KG ontology, policy và executor trong cùng PR. [R28], [R29], [R30], [R34]

## 6. Thiết kế nghiên cứu và thực nghiệm

### 6.1 Ba tầng chứng minh

1. **Architecture correctness:** deterministic property/integration tests trên seams thật; không cần LLM/target để kiểm ownership, binding, bounds, failure isolation.
2. **Decision quality:** benchmark mới multi-step, partially observable; live model + môi trường scripted, golden state chỉ ở evaluator.
3. **Operational effectiveness:** authorized realistic labs với execution/proof thật, reset/snapshot tái lập; nhiều domains nếu muốn kết luận whole-system. [R3]

**[PROPOSED]** P4 là một suite/design mới, không đổi tên P3 rồi coi replay reads là exploration. P3 giữ regression role cho checkpoint/provenance. Simulator cần state transitions và observation function; POMCP dùng black-box simulator trong bài gốc, nhưng điều đó không cung cấp simulator hay calibrated model của Raptix. Chỉ abstract bài được đối chiếu ở đây; không đề xuất triển khai POMCP từ kết quả game benchmarks. [R4], [E3]

### 6.2 Episode mới và chống oracle leakage

- Evaluator giữ hidden world state, scenario family, available transitions, negative controls, outcome truth và mission proof predicates; agent chỉ thấy authorized initial observations.
- Từng action phát sinh observation/artifact theo state hiện tại và conditions; evidence mới có thể mở surface, thay auth state, bác dependency hoặc tạo inconclusive.
- Agent đề xuất hypotheses/actions, cập nhật OPPLAN tại checkpoints, thu evidence, chọn continue/revise/gather/stop và đóng episode trong budget.
- Không đưa vulnerability tags/golden paths/required reads/expected action vào prompt, tool metadata hoặc cache key agent nhìn thấy. Tắt benchmark Tag→Skill fast-path cho experiment khám phá; nếu dùng, báo riêng là oracle-assisted control. [R18]
- Cho phép nhiều strategy/action hợp lệ; chấm outcome và invariants, không ép đúng một trace. Reference optimal/oracle có thể cho upper bound evaluator-only, không là deployable baseline.
- Bắt đầu với scenario ngắn đủ ≥2 decision updates và một hidden dependency; độ dài/số families là design choices, khóa sau dev pilot, không tuyên bố đã chạy.

**[PROPOSED]** Families tối thiểu theo failure mechanism: shared action giữa claims; stale positive → contradiction; discovery mở nhánh mới; thiếu auth/precondition; path topology đúng nhưng capability chưa verify; high-uncertainty distraction; execution fault; competing goals dưới budget. Scenario experts bổ sung invariants không có trong template để đo exploration ngoài registry.

### 6.3 Cần ghi cả candidate chưa launch

**[PROPOSED]** Tại decision checkpoint lưu considered candidates, hypothesis links, eligible/rejected reason, ranking features, selected set, snapshot/version, remaining budget và timestamps queue/launch/finish. Không lưu chain-of-thought; lưu structured decision record và completion công khai cần cho audit. Raw credentials/parameters không vào telemetry; sensitive recording ở artifact store kiểm soát riêng. [R26], [R27]

Candidate log chỉ chứng minh những gì đã biểu diễn; “missed hypothesis” phải đối chiếu hidden opportunities của simulator hoặc expert annotation. Ghi cả vì sao case không quan sát được/không thể test; không tính latent opportunity chưa reachable như failure dispatch. Nếu log bị truncate, báo denominator/missingness, không coi không có row là đã cân nhắc. [R3]

### 6.4 Baselines và ablation một biến

| Nhánh [PROPOSED] | Policy | Concurrency / mục đích |
|---|---|---|
| B0 | Current priority-ordered OPPLAN/surface workflow, context flags pinned | Fixed3, baseline runtime chính |
| B1 | Cùng B0 | Serial1: xác định throughput/isolation và speculative waste |
| H1 | Simple cost/evidence-gap/coverage heuristic, giữ candidate generator | Fixed3: ranking có cần phức tạp không? |
| C1 | Sửa đúng một context/projection hoặc replan seam | Fixed3: causality của named failure |
| F1 | Bounded frontier prototype sau gate, generator giữ nguyên | Fixed3: hiệu quả allocation |
| D1 | Cùng policy tốt nhất đã freeze | Adaptive1–3: chỉ đổi launch concurrency |

Không cộng simultaneously richer context, model routing, candidate generation và adaptive scheduling rồi gán gain cho frontier. B0 là actual model-mediated workflow; helper deterministic priority là thêm control có cùng observed inputs, không được đọc hidden truth.

“Fixed3” ở đây nghĩa là ceiling cố định **tối đa 3**, không ép luôn chạy ba jobs khi chỉ có một hoặc hai jobs hợp lệ. Vì cap production đang thể hiện trong prompt, controller thí nghiệm phải áp cùng hard resource envelope cho mọi nhánh và ghi batch đề xuất trước clamp/rejection. Báo rõ B0 là current selection policy dưới envelope thí nghiệm, không gọi nó là exact production scheduler; trace production riêng dùng để xác minh baseline native.

Mỗi nhánh cùng token/model/tool/exec ceilings và wall deadline; accounting gồm ranking/generation/recheck/verification/retry/closure, không cấp compute miễn phí cho controller. Theo dõi wall-time và summed executor time riêng: parallel có thể giảm thời gian nhưng tăng wasted speculative work. Batch chỉ được khởi chạy khi còn đủ reservation; harness phải kiểm overshoot, không dựa riêng USD poll. [R23]

### 6.5 Fairness, lỗi và tái lập

**[PROPOSED]** Giữ model alias/routing, prompts trừ ablation, tools/executor image, sampling settings, retry/fallback và initial state giống nhau theo cặp. Khóa reported underlying model nếu proxy có; alias trùng backend không tính là model độc lập. Khi model ID không được báo, ghi unknown. Scheduling seed không bảo đảm deterministic generation. [R4]

Phân tầng model theo capability/cost đo được, không đặt “weak” bằng marketing name. So weak-base/weak-change/strong-base/strong-change tại budget chung; phân tích routing sang strong model là experiment riêng, tính toàn bộ escalation cost. Không khẳng định parity ngoài families đã thử.

Provider/auth/timeout/recursion/parser/sandbox lỗi được phân loại, giữ trong yield denominator. Preflight xác nhận có live turns/usage/route khỏe trước matrix; report all-errors exit nonzero và artifacts vẫn giữ. Missing usage/cost là unknown, không zero; lỗi provider không là refutation. Env flags process-global nên chạy process-isolated hoặc sequential như P3. [R4], [R5]

Lab: session/workdir/output namespace riêng; target mutable state cũng phải reset/clone hoặc serialize conflicting actions. Test cancellation và late writes, one-cell fail trong batch, tmux/backend faults, resume/idempotency. B0 isolation GO cũ chỉ ghi hai local shell sessions; không chứng minh mọi sidecar/target/image mới cô lập. [R17], [R31], [E1]

Manifest cần code/tree snapshot hoặc patch hash khi dirty, lockfile, prompt/skill/tool schema hashes, dataset/split/annotation versions, model route/settings, target/sandbox image digests, initial DB/fs snapshots, timeout/ceilings, scheduler seed và artifacts. Pin lab reset procedure; một commit hash kèm `dirty=true` không tái lập đầy đủ parallel work. [R4], [R9], [R27]

### 6.6 Property và metamorphic tests

- Thêm alias/copy evidence không tăng producer lineage hay utility; unrelated claim không được citable; rejected output không làm tăng correctness. [R6], [R7]
- Hoán đổi presentation order không đổi deterministic ranking ngoài tie-break đã công bố; duplicate hypothesis không nhân action launch/value.
- Thu hẹp scope không sinh action mới ngoài scope; score cao không vượt RoE; đổi auth context không reuse result sai điều kiện. [R25]
- Tăng cost một action không tự làm nó ưu tiên hơn nếu features khác cố định; giảm budget không vượt ceiling, chưa đủ verification thì không report-supported.
- Contradiction hợp lệ làm invalid dependent eligibility được xét lại; timeout/inconclusive không tự refute; freshness/target revision đổi buộc recheck.
- Projection không mutate owner state, không trộn engagements; J1/J2 không nhận route của nhau; missing producer/freshness giữ unknown.
- Completion order khác nhau không làm mất objective/accounting; parent không nhận private child channels; fail/timeout không rò session/artifact attribution. [R19], [E1]

**[PROPOSED]** Assert invariant/ranking consistency và outcome, không snapshot một “đáp án thông minh” duy nhất. Tests dùng production seam với scripted environment/provider, không mock chính policy dưới test. Các kiểm tra này được đề xuất, chưa chạy trong tài liệu này. [R3], [R30]

## 7. Metrics, protocol và decision gates

### 7.1 Scorecard tối thiểu

| Nhóm | Chỉ số và mẫu số cần công bố |
|---|---|
| Mission | Verified goal yield / mọi scheduled missions; wrong/unsupported reporting; correct stop riêng |
| Evidence | Raw joint correctness; provenance accepted coverage; conditional accuracy; correct-bound yield; rejection reasons |
| Exploration | Useful hypotheses/opportunities reachable theo evaluator/expert; observed-surface coverage, uncovered invariants, starvation |
| Planning | Replan sau contradiction, invalid dependency launch, unnecessary repeat, stop trước/đúng/quá muộn |
| Efficiency | Token/model/tool/exec calls và USD khi biết; budget overshoot; redundant actions; speculative wasted executions |
| Latency | End-to-end, time-to-first-verified-goal, queue/model/tool/verification breakdown; median/tail; timeout frequency |
| Reliability/scope | Infra failures/partial results; forbidden attempts vs executed side effects; isolation/canonical-state violations |

### 7.2 Statistical unit và ngưỡng

**[PROPOSED]** Primary paired unit là **scenario family**: tổng hợp repetitions/variants trong family trước lấy chênh lệch policy; model là strata, không dataset độc lập. Metamorphic siblings và aliases/repetitions không được nhân thành hàng trăm independent samples. Báo per-family/per-model effects, paired uncertainty bằng family-level bootstrap hoặc paired randomization khi thiết kế cho phép; ít families thì nói rõ độ bất định.

Khóa primary endpoint, workload weights, analysis plan, số lần xem kết quả và stopping rule trước fresh holdout. Chọn minimum worthwhile gain `δ_goal`, non-inferiority margins về false positives/coverage/cost và latency ceiling từ yêu cầu mission + dev pilot; maintainer duyệt protocol trước evaluation. Đây là tham số còn mở, không ngưỡng +15% phổ quát hay ngưỡng dựng sau kết quả.

**[PROPOSED]** Candidate chỉ GO khi đạt gain thực dụng đã đăng ký, uncertainty đủ cho quyết định, không vượt safety/correctness ceilings, không giảm coverage/yield để làm conditional accuracy đẹp, và chi phí triển khai được biện minh. Nếu khoảng bất định quá rộng, kết luận insufficient evidence; nếu B0 tốt bằng/tốt hơn thì giữ B0 là kết quả thành công.

#### 7.2.1 Phụ lục (2026-10-13): tính δ_goal tạm từ nhiễu tự nhiên của P3

**[OBSERVED]** Thay vì tự đặt `δ_goal`, đo độ nhiễu tự nhiên thật: parse lại
`episodes.jsonl` gốc của 2 run P3 (`run-20261012_105048_203784` dev, `run-20261012_110254_792133`
held-out — cùng 2 file đã dẫn ở [P3DEV]/[P3HOLD]), gộp `scores.decision_correct` theo
`(model, variant, repetition)`, rồi theo `(variant, repetition)` pooled toàn bộ model.

**Held-out (480 episode, đáng tin hơn dev vì n lớn hơn):**

| Variant | rep0 | rep1 | rep2 | spread qua 3 lần |
|---|---|---|---|---|
| baseline | 61.25% | 52.50% | 60.00% | 8.75pp |
| evidence | 65.00% | 63.75% | 60.00% | 5.00pp |
| **gain (evidence−baseline)** | 3.75% | 11.25% | 0% | **11.25pp** |

Gain trung bình 3 lần = 5,0% (khớp đúng số `154/240`→`163/240` đã công bố trong §2.1) —
nhưng **độ nhiễu của chính gain đó (11,25pp) lớn hơn gain trung bình**. Ở mức model riêng
lẻ, độ nhiễu còn cao hơn (trung bình 12,5pp, cao nhất 18,8pp ở MiniMax-M2.7). Dev corpus
(180 episode, nhỏ hơn) nhiễu còn lớn hơn nữa (gain spread 30pp) — đúng quy luật thống kê,
mẫu nhỏ nhiễu nhiều hơn.

**Kết luận tạm:** `δ_goal` phải **≥ 10 điểm %** để vượt ngưỡng nhiễu đo được ở held-out với
đúng sample size này (3 lần lặp × 16 scenario × 5 model). Đây KHÔNG phải ngưỡng phổ quát —
nếu tăng số lần lặp/scenario, nhiễu sẽ co lại (theo √n), lúc đó `δ_goal` nhỏ hơn 10pp mới
đáng tin được. Margin cho false-positive/coverage/cost/latency chưa tính theo cách này —
cùng phương pháp áp dụng được khi cần, chỉ cần field tương ứng có trong `scores`/`cost_usd`.
Số này chờ maintainer duyệt trước khi dùng cho bất kỳ quyết định GO/NO-GO thật.

### 7.3 Deliverables theo gate

| Gate | Deliverable bắt buộc | Quyết định |
|---|---|---|
| G0 — Valid evidence | Healthy provider/executor preflight, manifest, error/usage audit, paired completeness | Lỗi route/auth hay incomplete matrix: sửa measurement, không so policy |
| G1 — Named insufficiency | Failure packet + reproduction + simple alternatives cho OPPLAN/Dispatch/Observation seams | Chưa chứng minh thiếu: không scope runtime planner/projection subsystem PR. [R1] |
| G2 — Architecture correctness | Property/metamorphic results, ownership/eligibility/budget/isolation review | Vi phạm hard invariant: sửa; không đổi score để vượt gate |
| G3 — Decision benefit | Preregistered protocol, dev ablations, frozen candidate, fresh holdout paired report với uncertainty | Promote bounded lab experiment, giữ baseline, hoặc thu thêm families |
| G4 — Operational transfer | Reproducible target/image snapshots, lab proof/artifacts, cost/latency/failure/rollback evidence | Chỉ scope đã validated mới xem xét opt-in runtime rollout |
| G5 — Rollout | Proposed ADR nếu cần, owner/consumer rõ, small PR, flag-off/on E2E và rollback | Default activation là quyết định riêng sau evidence, không tự động từ P3 |

## 8. Lộ trình nghiên cứu và triển khai

**[PROPOSED]** Tranche đầu tiên là measurement/reproduction, owner logic ở `benchmarks/`, consumer là người quyết định G1. Tạo fixture `F-PROJ-JEWEL-01` đi qua query/projection thật, chụp input model và phân biệt source correctness với policy response; song song trong cùng nghiên cứu kiểm actual dispatch timeline bằng existing recording, không xây planner runtime.

Sau G1, chọn **một** concern: nếu target binding sai được tái hiện thì PR nhỏ tại `knowledge/graph/summary.py` + focused integration test; nếu candidate hợp lệ bị kẹt thì chọn existing dispatch seam; nếu evidence đã thấy nhưng replan sai thì chọn OPPLAN checkpoint. Maintainer chỉ định reviewer/owner cụ thể trước PR; không suy đoán cá nhân từ vị trí file.

Nếu simple fix đủ, đóng nghiên cứu frontier/fan-out bằng “keep existing policy”. Nếu vẫn thiếu và đạt gate, prototype offline bounded ranking trong benchmark, kiểm B0/B1/H1 trước F1/D1; interface mới hoặc owner boundary cần ADR. Tranche runtime tiếp theo chỉ nâng đúng seam đã chứng minh, không cả ba frontier/projection/fan-out.

Rollout tối thiểu: default-off, opt-in engagement/profile, shadow không thay action trước, active scope hẹp sau G4; log policy version và fallback reason. Shadow scorer lỗi/timeout trả original behavior, không chặn tool; rollback về current policy và state owners cũ, không yêu cầu KG migration. In-flight effects phải drain/cancel có accounting, không đổi policy giữa thread thiếu version fence. [R28], [E1]

Checklist verification của PR tương lai: focused failing reproduction → fix → appropriate package/structural tests, lint/type checks theo CI, actual middleware/runtime E2E flag-off/on, infra failure và rollback; skill edit chạy audit/graph gates, public Core change chạy API stability. Không có runtime test/benchmark mới nào đã được thực hiện trong nghiên cứu docs-only này. [R30]

## 9. Kết luận và các quyết định còn mở

**Có thể trả lời ngay:** mục tiêu là verified mission yield trong budget, không conditional accuracy riêng; baseline đã có dynamic OPPLAN, bounded matrix/chaining, dispatch ledger và read-only projections. Horizontal/vertical độc lập breadth/depth/concurrency. Provenance binding không giải quyết reasoning hoặc hypothesis discovery. Không có căn cứ hiện tại để tuyên bố P4 GO. [R1], [R3], [R4]

**Định hướng tạm thời:** ưu tiên tái hiện projection target-binding và semantic-path ambiguity, rồi evidence-aware replanning/shared-result reuse trên seams hiện có. Giữ cap 3, thử serial1; heuristics được gọi đúng tên; frontier chỉ sau named insufficiency và simpler baselines.

**Cập nhật 2026-10-13 (implement + live-model testing, không phải chỉ đọc code):** Cả 5 case ở §3.1 đã được chạy thật (không còn [PROPOSED] chưa chạy). `F-PROJ-JEWEL-01` fix xong (TDD, merge-ready, **đã commit** `ad5a826`) + tác động hành vi đo được trên 3 model thật. `F-SHARED-ACTION-01` và `F-COVERAGE-01` xác nhận là rủi ro/gap thật ở tầng kiến trúc/registry (12/12 live-model evidence mỗi case) — nhưng **cả hai phụ thuộc vào coverage-matrix subsystem (ADR-0023/0026) mà 6 engagement thật đang có dữ liệu cho thấy KHÔNG được dùng** (`objective_expand`=0/6 run, §2.2). `F-PROJ-SEMANTICS-02` sửa wording nhưng không đo được tác động. `F-REPLAN-01` **không xác nhận được failure** — model tự replan đúng 5/5 lượt hoàn thành khi được đưa evidence mâu thuẫn rõ ràng.

**Quyết định cuối cùng cho hướng coverage-matrix (2026-10-13, sau audit §3.1.3 trên cả 6 engagement — không chỉ đọc code mà đối chiếu lại recon thật vs skill/dispatch thật):** **không khôi phục coverage-matrix, không mở rộng registry.** `F-SHARED-ACTION-01` và `F-COVERAGE-01` đóng, không mở PR. Lý do cụ thể: ca khó nhất quan sát được (`silentium`) cho thấy free-form (skill router `exploit/web/SKILL.md` 27-kỹ-thuật + suy luận tự do vượt khỏi cả router đó — chuỗi TypeORM operator injection/JWT-forge-race-condition/Socket.IO sniffing không khớp tên bất kỳ skill nào) đang tạo kết quả **tốt hơn** matrix 10-class; ép về matrix sẽ làm hệ thống kém đi trên đúng loại phát hiện giá trị nhất. Registry hẹp hơn cả hai thứ đang thật sự chạy, nên mở rộng nó cũng không giải quyết gì. Câu hỏi coverage thật (model có bỏ sót gì ngoài cả hai danh sách không — Q13) **không trả lời được từ log** (bản chất "chưa biểu diễn" không để lại dấu vết) — chuyển hẳn sang ưu tiên xây benchmark hidden-world (§6.2) làm hướng đo coverage chính của P4 từ đây. Một ý tưởng riêng, chưa quyết định làm: thêm tầng "sàn cứng" bằng tool quét tự động (nuclei/CVE-fingerprint, default-creds, header/TLS misconfig, dò file lộ, fuzz injection cơ bản, kiểm rate-limit) chạy mặc định không phụ thuộc model — khác matrix vì không giới hạn free-form, chỉ bảo đảm tầng lỗi máy móc/phổ biến; hiện **không có bước nào chạy mặc định như vậy** trong hệ thống.

**Cập nhật 2026-10-13, vòng thứ hai (Q07/Q12/Q14/Q02):** `Q07` đóng dứt điểm bằng code —
không có cơ chế nào đọc nhãn horizontal/vertical, và khuyến nghị **chủ động không xây** vì
chính rủi ro đã được epistemic-core document gốc cảnh báo (ranh giới phân loại mơ hồ, nguy
cơ dùng nhãn để lách authorization); giữ khái niệm này ở tầng mô tả/báo cáo (MITRE tag) thôi.
`Q12` (budget-aware stopping): năng lực model xuất sắc (12/12 live-model test đúng cả 2 điều
kiện), nhưng production không surface số budget còn lại cho model và không cho lượt chốt
việc cuối khi hard-stop — gap wiring nhỏ, rõ, không cần quyết định kiến trúc. `Q14` (scope/
budget/concurrent ownership): scope và concurrent-ownership ổn (double-gate RoE, session
isolation thật); nhưng **budget enforcement có race condition toán học thật** — lock chỉ bảo
vệ cache đọc chung, không reserve chi phí cho N lệnh đồng thời, nên batch song song (ADR-0026
fixed-3) có thể vượt cap mà không bị chặn tới lần poll sau.

**Đã fix (2026-10-13, commit `fc09daa`):** gộp đúng 1 PR cho cả Q12+Q14 trên
`middleware/budget.py` như dự định. (1) Mỗi lần gọi model vượt `soft_warn` (70%), notice
text được append vào system message của model (không chỉ dashboard stream event như cũ),
lặp lại mỗi lần gọi (không chỉ 1 lần như dashboard) để model luôn có thông tin mới; vượt
`final_warn` (90%, ngưỡng mới) notice đổi giọng cấp bách hơn. Hard-stop ở 100% **giữ nguyên
không đổi** — không cấp thêm lượt gọi nào qua cap, chỉ đảm bảo model có cảnh báo thật trước
đó. (2) Thêm `_inflight` (đếm số lệnh đã admit, chưa hoàn thành, theo scope) + reserve
`RESERVE_PER_CALL_PCT` (mặc định 1%) của cap cho mỗi lệnh đang bay, release khi lệnh xong
(thành công hay lỗi) — chặn đúng race đã chứng minh toán học ở Q14. TDD đầy đủ: test mới
xác nhận cả notice injection và race-fix (`results.count(True) <= 1` khi 3 lệnh đồng thời
đấu vào ngân sách gần hết) — 50/50 test pass (32 cũ không regress + 18 mới), lint/format/
basedpyright sạch (0 error). Cả hai vẫn opt-in qua `ENGAGEMENT_USD`/`PER_AGENT_USD` hiện có,
mặc định tắt — không đổi behavior cho ai chưa dùng tính năng budget. `Q02` (bottleneck):
phân rã critical-path thật trên 2 engagement (không cần
LLM thêm) loại trừ KG/OPPLAN/skill-load overhead (<1%, không phải bottleneck); phát hiện cụ
thể nhất — recon tự lặp lại 1 full-port-scan tốn kém chiếm 51% tổng thời gian 1 engagement,
ứng viên named-failure thật (n=1, cần thêm dữ liệu).

**Cập nhật 2026-10-14 (3 run mentor thật — bổ sung run 2/3 vào run 1 đã phân tích trước, cross-check độc lập bởi phân tích riêng của người dùng tại `benchmarks/results/runs/mentor/analysis/P4-observations-3runs.md`, đối chiếu lại số liệu/claim trước khi tin):** GraphRecursionError xác nhận là pattern **lặp lại trên cả 3 run** (không phải fluke của run 1) — 8 lần crash, 4.9–76.4 phút mỗi lần, có lần agent đã thỏa acceptance criteria rồi mới bị cắt. `b500187` (Q02 recon re-scan fix) giữ vững 3/3 run — không run nào re-scan toàn bộ khi gặp mâu thuẫn. `ad5a826` (KG/crown-jewel projection) và `fc09daa` (budget) tiếp tục **không được exercise** trong production thật (kg_record gọi đúng 1 lần/run, budget vẫn tắt theo chủ đích) — không claim được gì thêm ngoài "chưa test được trong lane này". Headline "3.8x cost spread cùng điều kiện" của phân tích gốc **có confound**: target run 2 không sạch (còn artifact run 1 — password/crontab/cmd_exec evidence cũ), nên không dùng làm bằng chứng so sánh chéo sạch; per-call context size (~70k token/call ở exploit agent, mọi run) vẫn là quan sát hợp lệ vì không phụ thuộc so sánh chéo.

Dispatch wall-clock timeout (45 phút, override `RAPTIX_DISPATCH_TIMEOUT_SECONDS`, `asyncio.wait_for` quanh `DispatchMiddleware.atask`, `TimeoutError` phân loại đúng vào `FailureKind.EXECUTION`) đã implement + TDD xanh (10/10 test, không regress 12 test liên quan, lint/basedpyright sạch) nhưng **chưa commit** — đang ở worktree riêng `.claude/worktrees/tool-dispatch-fix` trên branch `tool`, chờ người dùng tự chạy lab đối chiếu trước khi chốt.

Ba phát hiện còn lại từ 3-run analysis, quyết định **có chủ đích không sửa/hoãn** (2026-10-14, ưu tiên tuyệt đối offensive capability — hệ thống autonomous red-team, mọi fix làm giảm năng lực khai thác bị loại trước khi cân nhắc chi phí/lợi ích khác):

- **[QUYẾT ĐỊNH: không cần sửa thêm]** Dispatch chết ngay sau khi acceptance criteria đã đạt (mất report cuối). Đào sâu `StreamingRunnable.ainvoke()` phát hiện cơ chế lưu tạm (`partial_state_refs` quét mọi `write_file`/`edit_file` thành công từ transcript, gói vào `DispatchFailureOutcome`) **đã tồn tại sẵn**, không mất trắng như giả định ban đầu. Phát hiện phụ (chưa quyết định xử lý): `DispatchMiddleware._finish` không bao giờ thấy GraphRecursionError là failure thật (bị `ainvoke()` nuốt và trả về dạng "success"-shaped Command) nên `MAX_SUBAGENT_CONSECUTIVE_FAILURES` vô hiệu với riêng class lỗi này — việc nối 2 tầng fault-tracking lại là scope lớn hơn, kiến trúc, để riêng, không trong tranche này.
- **[DEFERRED — người dùng chủ động hoãn, sợ giảm offensive capability]** Credential-purpose binding (structured cred-table `{value, source, purpose, validated_against}` thay vì raw string) — 0/3 run theo đúng path credential của writeup. Đây là finding leverage cao nhất trong 3-run analysis nhưng scope lớn (≥3 PR: tool/schema mới, sửa prompt exploit/postexploit, sửa cách orchestrator build dispatch description), và người dùng lo thay đổi cách credential lưu truyền có thể cản trở luồng khai thác hiện tại. Không động tới cho tới khi có quyết định khác.
- **[QUYẾT ĐỊNH: không sửa]** Full-port scan bắn trùng 2 lần cách 13 giây (run 2). Hướng sửa khả dĩ (dedupe guard chặn lệnh giống hệt lặp lại trong N giây) có rủi ro chặn nhầm 1 lần re-scan agent **chủ ý** làm (tự verify lại kết quả nghi flaky) — rủi ro giảm capability lớn hơn hẳn chi phí thực của lỗi (13 giây, 1 lần, không lặp thành loop). Giữ nguyên, không sửa.

**[OPEN]** Cần thực nghiệm trả lời: bottleneck nào mất yield nhiều nhất (một phần đã trả lời
ở §3.2.1 — xem trên); agent thực sự tuân cap và launch overlap ra sao (một phần đã trả lời ở
§3.3.1 — chưa từng chạm cap 3, và `surface_exploit` chỉ 1/51 dispatch thật); **hypothesis nào
chưa từng được biểu diễn — nay là câu hỏi coverage chính, xem Q13 + §3.1.3, cần benchmark
hidden-world mới trả lời được**; cost/freshness/independence estimate có đáng tin; coverage
budget bao nhiêu; lúc nào nên dừng (một phần đã trả lời ở Q12 — năng lực tốt, wiring thiếu);
gain có chuyển sang lab/AD/cloud và model khác; margins/compute budgets nào có giá trị thực
dụng.

**Giới hạn xác minh:** đã đọc code/ADRs và official sources bên dưới, audit lại hai P3 reports cùng journals/metrics/boundary; đã bổ sung (2026-10-13) fix+TDD reproduction thật cho 1 case và live-model test (18+ lệnh gọi LLM thật qua 3 model được cho phép) cho 4 case còn lại, cộng phân tích 6 record.jsonl engagement thật đã có sẵn. Nghiên cứu này **vẫn chưa** chạy P4 simulator, chưa dựng engagement/benchmark MỚI (live-model test dùng single-turn/multi-turn completion, không phải agentic loop đầy đủ qua sandbox/target thật), và mọi finding "latent risk" (F-SHARED-ACTION-01, F-COVERAGE-01) mới đo ở tầng model, chưa đo qua dispatch/sandbox thật. Không xác nhận actual production deployment config ngoài 6 run đã phân tích, live executor health hiện tại, proxy backend identity ngoài 3 model đã gọi, hay paper results áp dụng cho Raptix. Static seams không thay causal evidence; abstract nghiên cứu bên ngoài chỉ cung cấp khái niệm, không chứng minh hệ thống khai thác tốt hơn.

P3 held-out cũ đã có outputs được xem nên là regression/known-family evidence cho P4, không fresh evaluation. Tạo train/dev và **fresh heldout families** độc lập trước tune; khóa prompts/policy/protocol rồi mới mở outputs. Không tune bất kỳ held-out nào, kể cả capability fixtures đang được repo bảo vệ. [R26], [R30]

## 10. Nguồn tham khảo

Nguồn repo dùng đường dẫn tương đối từ `docs/design/`; external pages được fetch/đọc ngày 2026-10-12. [E1]/[E2] là official docs; [E3]/[E4] là abstract chính thức của công trình gốc, không review thứ cấp. `uv.lock` pin LangGraph 1.2.4; docs latest phải đối chiếu installed version trước dùng API mới. [R32]

- Kiến trúc/ownership: [ADR-0049][R1], [state inventory][R33], [runtime boundaries][R28], [dependency rules][R29].
- Baseline thực thi: [OPPLAN][R10], [surface helper][R35], [dispatch][R19], [KG summary/projection][R20], [P3 suite][R4].
- Bên ngoài: [LangGraph Graph API][E1], [Graph API guide][E2], [Silver & Veness 2010][E3], [Guo và cộng sự 2017][E4].

[R1]: ../adr/0049-evidence-model-extends-capability-contract.md "ADR-0049, decision 5: concrete named failure gate"
[R2]: ../structure-review.md "Architecture review, P3/P4 deferral and independent policy axes"
[R3]: 2026-10-11-exploitation-reasoning-epistemic-core.md "Epistemic discussion §§6–8, adjudicated by ADR-0049"
[R4]: ../../benchmarks/suites/decision_eval/README.md "P3 protocol, interpretation and recorded delivery checkpoint"
[R5]: ../../benchmarks/suites/decision_eval/evaluate.py "Replay agent, scorer, scheduling, telemetry and CLI exit"
[R6]: ../adr/0066-bind-decision-output-to-consumed-provenance.md "Provenance boundary scope and observed citation failures"
[R7]: ../../GLOSSARY.md "Recorded claim, evidence reference, producer lineage and capture integrity"
[R8]: ../adr/0064-evaluate-evidence-informed-decisions-with-replay.md "P3 cannot establish P4 need or operational effectiveness"
[R9]: ../../langgraph.json "Graph entrypoints, env and checkpointer"
[R10]: ../../packages/raptix/raptix/orchestration/mission/opplan.py "OPPLAN state, prompt injection and sequential calls"
[R11]: ../../packages/raptix/raptix/intelligence/agents/standard/raptix.py "Actual orchestrator assembly and subagent discovery"
[R12]: ../../packages/raptix/raptix/execution/tools/plumbing/opplan.py "Objective transitions, dependencies and backend persistence"
[R13]: ../../packages/raptix/raptix/knowledge/graph/tools.py "kg_surface_inventory query and derived children"
[R14]: ../../packages/raptix/raptix/intelligence/agents/standard/_surface_registry.py "Applicability, cell identity and objective payloads"
[R15]: ../../packages/raptix/raptix/intelligence/agents/standard/_surface_reexpand.py "Generation/population bounds and dedup"
[R16]: ../adr/0023-bounded-iterative-surface-reexpansion.md "Re-expansion semantics; later launch policy in ADR-0026"
[R17]: ../adr/0026-bounded-parallel-surface-fanout.md "Fixed3, session separation and sequential accounting"
[R18]: ../../packages/raptix/raptix/intelligence/prompts/standard/raptix.md "Runtime workflow, failure/replan instructions and benchmark fast-path"
[R19]: ../../packages/raptix/raptix/middleware/dispatch.py "Persistent dispatch ledger, in-flight identity and child-state filtering"
[R20]: ../../packages/raptix/raptix/knowledge/graph/summary.py "Bounded context and current planning-path Cypher"
[R21]: ../../packages/raptix/raptix/middleware/kg.py "Revision refresh, optional projections and injection"
[R22]: ../../packages/raptix/raptix/knowledge/graph/operational_state.py "Recorded relationships are not liveness/access proof"
[R23]: ../../packages/raptix/raptix/middleware/budget.py "Spend polling, model-call enforcement and failure behavior"
[R24]: ../../packages/raptix/raptix/middleware/tried_edges.py "Observational attempt ledger; exit-zero is not claim verification"
[R25]: ../../packages/raptix-core/raptix_core/types/capability.py "Frozen contracts, completion bounds, availability/eligibility/authorization"
[R26]: ../tool-optimization-implementation-plan.md "Normalization ownership, capability honesty and evaluation constraints"
[R27]: ../../packages/raptix/raptix/execution/session/recording.py "Record/replay envelopes and fidelity limits"
[R28]: ../architecture/runtime-boundaries.md "One state owner; middleware adapters; WHAT/HOW split"
[R29]: ../architecture/dependency-rules.md "Package import directions and structural checks"
[R30]: ../QUALITY_BAR.md "Small changes, meaningful tests and E2E verification; see CONTRIBUTING_AGENT.md"
[R31]: ../adr/0021-b0-session-isolation-gate.md "Recorded two-session local shell isolation GO and limited scope"
[R32]: ../../uv.lock "Pinned LangGraph version"
[R33]: ../architecture/state-ownership-inventory.md "Dated state survey, overlaps and pre-existing projection seam"
[R34]: ../../CONTRIBUTING_AGENT.md "Contribution scope, public boundaries and verification contract"
[R35]: ../../packages/raptix/raptix/intelligence/agents/standard/_surface_dispatch.py "Deterministic bounded batch helper; live caller must be verified"
[P3DEV]: ../../benchmarks/results/runs/decision-eval/run-20261012_105048_203784/report.json "Ignored local development artifact"
[P3HOLD]: ../../benchmarks/results/runs/decision-eval/run-20261012_110254_792133/report.json "Ignored local held-out artifact"
[E1]: https://docs.langchain.com/oss/python/langgraph/graph-api "Official Graph API: state/reducers/Send/Command/idempotency"
[E2]: https://docs.langchain.com/oss/python/langgraph/use-graph-api "Official Graph API guide: updates, parallel writes and timeouts"
[E3]: https://proceedings.neurips.cc/paper/2010/hash/edfbe1afcf9246bb0d40eb4d8027d90f-Abstract.html "Silver & Veness (2010), Monte-Carlo Planning in Large POMDPs; official abstract"
[E4]: https://proceedings.mlr.press/v70/guo17a.html "Guo et al. (2017), On Calibration of Modern Neural Networks; official abstract"
