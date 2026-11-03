# Auto Fan-out Dispatch: nghiên cứu + đề xuất tổng quát hóa

Trạng thái (2026-10-15): **Phase 0 đã implement** (ADR-0067, `middleware/dispatch.py`) và **Phase 1 đã implement** (ADR-0068, `_surface_registry.py` + `knowledge/graph/tools.py` + `intelligence/prompts/standard/raptix.md`), cả hai trên nhánh `tool` trong worktree `tool-dispatch-fix`. **Phase 2 vẫn CHƯA implement** — mục 5.3 dưới đây đã được viết lại sau khi đối chiếu với nghiên cứu mở rộng (`docs/proposals/temp.md`); quyết định "chưa xây" không đổi, chỉ hình dạng-khi-có-bằng-chứng được làm rõ hơn.

## 1. Bối cảnh — câu hỏi ban đầu

Raptix hiện có 21 agent "specialist", tách theo **domain** (web, AD, cloud, mobile...), không tách theo loại lỗ hổng. Khi 1 agent (ví dụ `exploit`) nghi ngờ 1 lớp lỗ hổng cụ thể (SSTI, SQLi...), nó không spawn agent mới — nó gọi `load_skill()` để nạp 1 file hướng dẫn kỹ thuật (markdown) vào chính context của nó rồi tiếp tục làm việc. Đây là cơ chế chính cho "dynamic" trong 1 luồng suy luận (đổi hypothesis, đổi kỹ thuật giữa chừng).

Tuy nhiên có 1 cơ chế KHÁC — **fan-out song song thật sự** (nhiều dispatch `task()` cùng lúc, mỗi cái 1 agent riêng xử lý 1 phần việc độc lập) — chỉ tồn tại cho đúng 1 trường hợp: web. Câu hỏi đặt ra: cơ chế này có đang bị giới hạn sai không, và có nên tổng quát hóa thành 1 công thức/phân loại rõ ràng, áp dụng được rộng hơn, thay vì chỉ hard-code theo domain?

## 2. Cơ chế hiện có — đọc trực tiếp code, không suy đoán

### 2.1. Coverage-matrix (web only)

- `kg_surface_inventory` (`knowledge/graph/tools.py:185-242`): đọc KG, trả về danh sách `Endpoint` + quan hệ con (parameter/form/technology/auth_model). Cypher hoàn toàn **không lọc theo phase** — chỉ scope theo `engagement`.
- `_surface_registry.py`: `VULN_CLASS_REGISTRY` (10 lớp: sqli, xss, idor, ssrf, authn_jwt, authz, ssti, xxe, open_redirect, graphql) — mỗi lớp có 1 predicate `applies` xét URL path/param/content-type — **hoàn toàn hard-code cho HTTP/web**. `build_coverage_matrix` dedup theo `surface_key` rồi cross-product ra "cell" `(vuln_class, surface_key)`.
- `_surface_reexpand.py`: logic bounded re-expansion (`max_generations=3`, `max_total_cells=50`, dedup, sort theo priority) — **đã tổng quát/thuần (pure), không có gì hard-code web**. Cell sinh ra từ việc mở rộng tiếp sau khi 1 cell cha confirm được gắn `via_cell` (lineage, không phải parent OPPLAN thật) — đây là tín hiệu "cell này phụ thuộc chuỗi", không độc lập.
- `_surface_dispatch.py`: `next_surface_exploit_batch` chọn tối đa `max_in_flight=3` cell `pending` ưu tiên cao nhất, bắn dispatch `surface_exploit` song song — generic, trừ 1 chỗ hard-code: filter `owner == "surface_exploit"`.

### 2.2. Điều kiện kích hoạt — ĐÂY LÀ CHỖ SAI

Prompt orchestrator (`intelligence/prompts/standard/raptix.md:37-48`) viết: *"khi objective đã duyệt có chứa chữ 'Initial Foothold', gọi `kg_surface_inventory` một lần... rồi `objective_expand` một lần"*.

**Grep trực tiếp 9 engagement thật** (6 trước + 3 run mentor phân tích gần đây) → `kg_surface_inventory` được gọi **0 lần**, kể cả bước đầu tiên. Lý do: mission thật dùng câu "initial access and foothold" (không viết hoa, khác cụm từ đang so khớp) — điều kiện trigger chưa bao giờ khớp.

Vấn đề không chỉ là lỗi chính tả/case — nó **sai về khái niệm**: gắn 1 tool hoàn toàn không-quan-tâm-phase vào ĐÚNG 1 phase cụ thể. Ví dụ cụ thể: agent pivot vào mạng nội bộ, tìm thấy 1 web nội bộ — về lý thuyết đáng được dùng lại cơ chế này, nhưng điều kiện hiện tại không cho phép vì không phải "Initial Foothold".

**Đã sửa ở Phase 1** (ADR-0068): điều kiện kích hoạt trong `raptix.md` không còn so khớp chữ "Initial Foothold" — trigger mới là "sau BẤT KỲ lần `recon`/`osint_operator`/pivot nào được phân loại xong", đọc đúng theo mục 3 dưới đây.

### 2.3. Domain khác — không có cơ chế tương tự

Đọc `ad_operator.md`, `cloud_hunter.md`, `mobile_operator.md`, `wireless_operator.md`, `iot_operator.md`, `ics_operator.md` — **không domain nào có khái niệm fan-out**. AD có case "nhiều host độc lập cần kiểm tra" (ví dụ liệt kê delegation-trusted hosts) nhưng xử lý hoàn toàn tuần tự trong 1 agent. `cloud_hunter.md` có chữ "parallel" nhưng chỉ là 3 tool-call trong CÙNG 1 lượt của 1 agent, không phải fan-out nhiều agent.

### 2.4. Phát hiện an toàn quan trọng — không liên quan trực tiếp câu hỏi ban đầu nhưng bắt buộc phải xử lý trước

`DispatchMiddleware` (`middleware/dispatch.py`) **không hề giới hạn số dispatch chạy đồng thời** trong code. `self._active` chỉ chặn việc gọi lại ĐÚNG 1 dispatch y hệt (chống double-fire), không đếm có bao nhiêu dispatch KHÁC NHAU đang chạy. Con số "tối đa 3" (ADR-0026) **chỉ là quy ước ghi trong prompt** — orchestrator có thể bắn bao nhiêu dispatch cùng lúc cũng được, không bị chặn.

Đọc cả 3 ADR liên quan (0021, 0023, 0026): tất cả chỉ chứng minh cô lập **phía orchestrator** (session/workspace riêng biệt qua tmux) — **không ADR nào xét rủi ro phía TARGET** (service dùng chung state, single-worker dễ bị treo khi nhận nhiều request đồng thời). Đây chính xác là nguyên nhân sự cố thật đã xảy ra (xem `docs/design/2026-10-12-p4-system-optimization-research.md`, mục "self-DoS wedge"): 1 payload chặn (block) vĩnh viễn 1 service `werkzeug` (Flask dev server, single-threaded mặc định) chạy đơn luồng — mọi payload cứu hộ sau đó, kể cả các dispatch chạy song song khác, đều bị kẹt theo cùng 1 chỗ nghẽn.

Nếu tổng quát hóa fan-out rộng hơn (dùng nhiều hơn, cho nhiều domain hơn) mà KHÔNG vá lỗ này trước, rủi ro tự làm treo chết foothold của chính mình sẽ tăng lên, không giảm.

## 3. Công thức / phân loại đề xuất

Toàn bộ tín hiệu dưới đây lấy từ dữ liệu `kg_surface_inventory`/`_surface_registry.py` đã có sẵn — không cần cấu trúc KG mới.

```
independent_count = số cell mà cell.get("via_cell") rỗng/None
    (cell có via_cell = sinh ra từ việc mở rộng tiếp sau khi 1 cell cha vừa
    confirm — tức PHỤ THUỘC CHUỖI, không độc lập — loại khỏi đếm)

should_fan_out  = independent_count >= 2
fan_out_width   = min(independent_count, resilience_cap, dispatch_ceiling)

resilience_cap  = 1  nếu công nghệ phát hiện được (từ detect_tech_stack, đã có
                      sẵn trong "technologies" của surface) khớp danh sách NGẮN,
                      CÓ BẰNG CHỨNG THẬT dễ treo khi chạy đồng thời
                      (hiện tại: chỉ "werkzeug" — đúng loại service đã bị treo
                      thật trong sự cố ghi ở mục 2.4)
                = 3  (mặc định hiện tại) nếu công nghệ không rõ/không khớp —
                      KHÔNG đoán "chắc an toàn", mặc định về mức thận trọng cũ
dispatch_ceiling = giới hạn THẬT do code enforce (Phase 0) — khác với "3" cũ
                      chỉ là chữ trong prompt, đây là ceiling không thể vượt qua
```

**Điều kiện kích hoạt mới** (thay "Initial Foothold" bằng dữ liệu, không phải phase): sau BẤT KỲ lần recon/osint/pivot nào được phân loại xong — bất kể đang ở phase nào — gọi `kg_surface_inventory`. Chỉ dựng matrix khi chính tool trả về `independent_count >= 2`. Case "pivot nội bộ tìm thấy web mới" tự động được xử lý đúng vì trigger không còn gắn với 1 phase cụ thể.

## 4. Đối chiếu bắt buộc với quyết định đã có (2026-10-13)

`docs/design/2026-10-12-p4-system-optimization-research.md` (dòng 613-627) đã ghi quyết định, dựa trên bằng chứng thật: **"không khôi phục coverage-matrix, không mở rộng registry"** — vì ca khó nhất quan sát được (`silentium`) là 1 chuỗi lỗ hổng phụ thuộc lẫn nhau (TypeORM injection → JWT race-condition → Socket.IO sniffing), và free-form xử lý ca đó TỐT HƠN matrix 10-lớp.

**Thiết kế ở mục 3 không đảo ngược quyết định đó**: công thức chủ động LOẠI TRỪ đúng case chuỗi-phụ-thuộc (`via_cell`) mà quyết định cũ bảo vệ. Free-form luôn là mặc định; matrix chỉ là **lựa chọn thêm vào** khi `independent_count >= 2` — tức nhắm vào case NGƯỢC LẠI (nhiều lỗ hổng độc lập, không chuỗi — ví dụ OWASP Juice Shop với ~100 challenge độc lập) mà cả 9 engagement thật đã phân tích (toàn bộ dạng HTB narrative/chain) **chưa từng test tới**.

## 5. Lộ trình implement (đã tách theo đúng ngân sách diff của CONTRIBUTING_AGENT.md — ≤400 dòng runtime/≤10 file/1 concern)

### 5.1. Phase 0 — Vá an toàn concurrency (ĐÃ IMPLEMENT)

Thêm bộ đếm theo `scope` trong `DispatchMiddleware`, chặn dispatch thứ N+1 bằng `dispatch_capacity_exceeded` thay vì để chạy ngầm không giới hạn. Ceiling mặc định 3 (khớp ADR-0026), override qua `RAPTIX_MAX_CONCURRENT_DISPATCHES`.

Đây là fix **tăng** capability, không giảm — ngăn hệ thống tự làm treo chết foothold của chính mình, không hạn chế kỹ thuật tấn công nào.

File đã sửa: `packages/raptix/raptix/middleware/dispatch.py`, `packages/raptix-core/raptix_core/types/dispatch_outcome.py` (phân loại `TimeoutError` đúng bucket `EXECUTION`), test cập nhật trong `test_dispatch_boundary.py`, ADR mới: `docs/adr/0067-enforce-dispatch-concurrency-ceiling.md` (đối chiếu ADR-0021/0023/0026).

### 5.2. Phase 1 — Sửa trigger cho web (ĐÃ IMPLEMENT)

Đã thêm `independent_cell_count()`, `server_resilience_cap()` (danh sách fragile hiện tại: chỉ `"werkzeug"`, so khớp substring vì nhãn công nghệ thường kèm version), và `recommended_in_flight()` = `min(independent_cell_count, server_resilience_cap)` vào `_surface_registry.py`. `kg_surface_inventory` (`knowledge/graph/tools.py`) trả thêm 2 field `independent_count`/`recommended_in_flight` bên cạnh `surfaces`/`cells`/`objective_children` hiện có. `raptix.md` đổi điều kiện kích hoạt: không còn so khớp "Initial Foothold" trong chữ objective — trigger mới là sau BẤT KỲ `recon`/`osint_operator`/pivot nào được phân loại, gọi `kg_surface_inventory` một lần; chỉ dựng matrix (`objective_expand`) khi `recommended_in_flight >= 2`; vòng dispatch chọn tối đa `recommended_in_flight` cell mỗi lượt (thay vì hardcode 3).

Lưu ý khác với công thức gốc ở mục 3: `recommended_in_flight` **không** nhân `dispatch_ceiling` vào — số đó chỉ còn là advisory cho orchestrator biết có đáng dựng matrix hay không; ceiling thật (Phase 0, ADR-0067) vẫn là chốt chặn duy nhất được code enforce tại điểm dispatch, tránh 2 nơi giữ 2 bản số ceiling có thể lệch nhau (lý do đầy đủ nằm trong "Alternatives considered" của ADR-0068).

File đã sửa: `packages/raptix/raptix/intelligence/agents/standard/_surface_registry.py`, `packages/raptix/raptix/knowledge/graph/tools.py`, `packages/raptix/raptix/intelligence/prompts/standard/raptix.md`; test cập nhật/thêm trong `test_surface_registry.py`, `test_kg_tools_unit.py`, `test_surface_dispatch.py`, `test_surface_reexpand.py`; ADR mới: `docs/adr/0068-data-driven-coverage-matrix-trigger.md`.

### 5.3. Phase 2 — Tổng quát hóa domain khác (CHƯA LÀM — quyết định không đổi, chỉ hình dạng được làm rõ hơn)

**Quyết định không đổi**: không domain nào khác có nhu cầu fan-out được xác nhận bằng bằng chứng thật — theo đúng kỷ luật ADR-0049 (không xây trước khi có named-failure thật). Phần nghiên cứu mở rộng ở `docs/proposals/temp.md` (đối chiếu Google "Towards a Science of Scaling Agent Systems", Anthropic multi-agent research system, Adaptive Submodularity, Bandits with Knapsacks, LLMCompiler) đi đến đúng cùng kết luận từ một hướng độc lập, không mâu thuẫn với quyết định này — xem đối chiếu chi tiết ở mục 5.3.1.

**5.3.1. Đối chiếu với `temp.md`: domain không phải gate, nhưng Phase 1 đã tự tuân theo điều đó**

Kết luận mạnh nhất của `temp.md`: *domain không nên là điều kiện kích hoạt fan-out; cấu trúc công việc tại thời điểm quyết định mới là điều kiện* (không viết `if domain == "web": enable_fanout = True`). Đối chiếu lại Phase 1 đã implement ở mục 5.2: điều kiện mới (`recommended_in_flight >= 2`, đọc từ KG tại runtime, loại trừ `via_cell`) **không check domain hay phase** — nó đã tự tuân theo đúng nguyên tắc này trước khi `temp.md` được viết. Hai tài liệu không đối lập; `temp.md` xác nhận độc lập lại discipline mà mục 3 đã tự đặt ra.

`temp.md` cũng cảnh báo 1 trục mà `_surface_registry.py` ban đầu không xét: *"nhiều hypothesis nhưng có thể bị giải quyết chung bởi 1 action rẻ hơn"* (value-of-information). Đối chiếu với `build_coverage_matrix`: mỗi cell là `(vuln_class, surface_key)` — cross-product của 2 trục orthogonal, dedup theo `surface_key`. Khác `vuln_class` cần kỹ thuật khác nhau; khác `surface_key` cần session khác nhau — không có cặp nào trong matrix có thể bị 1 action chung thay thế. Lo ngại của `temp.md` có cơ sở đúng cho bài toán tổng quát, nhưng với cơ chế web hiện tại nó đã tự động được thỏa mãn by construction — **không cần thêm 1 bộ "marginal value scorer" mới cho Phase 1**, và khi generalize sang domain khác (nếu có bằng chứng), đây là điều cần kiểm tra lại cho domain đó, không mặc định đúng.

**5.3.2. Hình dạng cần xây khi có bằng chứng** (ví dụ: trace cho thấy `ad_operator` tốn nhiều wall-clock thật vì kiểm tra tuần tự nhiều host độc lập):

- Tham số hóa `kg_surface_inventory`'s `MATCH (e:Endpoint)` thành nhận `node_label` tùy ý (phần Cypher còn lại đã tổng quát sẵn).
- Ghi `VulnClassSpec`/`applies` pattern của `_surface_registry.py` thành khuôn mẫu cho domain mới tự viết riêng (không kế thừa trực tiếp được — logic độc lập mỗi domain khác nhau hoàn toàn) — kèm việc tự kiểm tra lại giả định "mỗi cell orthogonal, không trùng lặp" ở mục 5.3.1 cho đúng domain đó, KHÔNG giả định nó tự đúng.
- `server_resilience_cap`'s `FRAGILE_UNDER_CONCURRENCY` là per-mechanism, không global — domain mới cần danh sách fragile riêng (hoặc xác nhận không cần) dựa trên bằng chứng thật của chính domain đó, không copy `{"werkzeug"}` sang.
- `_surface_reexpand.py` và ceiling từ Phase 0 đã tổng quát sẵn, không cần sửa gì thêm.
- **Không xây** 1 "Fan-out Eligibility Gate" tổng quát/subsystem mới dùng chung cho mọi domain trước khi có ≥ 2 domain thật cần nó — `temp.md` mục 10 cũng tự kết luận "không nên nhảy ngay đến adaptive fan-out engine hoàn chỉnh"; 1 cơ chế per-mechanism nhỏ (như Phase 1 cho web) rẻ hơn và rủi ro thấp hơn 1 lớp trừu tượng dùng chung chưa có ca thật thứ 2 để kiểm chứng.

## 6. Việc KHÔNG làm

- Không ép free-form chuyển qua matrix cho case chuỗi/phụ thuộc.
- Không tự ý mở rộng `VULN_CLASS_REGISTRY` (10 lớp web hiện tại).
- Không xây cơ chế cho domain khác (Phase 2) khi chưa có bằng chứng thật.
- Không xây 1 "Fan-out Eligibility Gate"/scorer tổng quát dùng chung nhiều domain trước khi có ≥ 2 ca thật cần nó (mục 5.3.2).
- Không gộp `server_resilience_cap`'s danh sách fragile-tech thành 1 danh sách global dùng chung mọi domain — mỗi domain tự có bằng chứng riêng.

## 7. Tham khảo

- `docs/proposals/temp.md` — nghiên cứu mở rộng (Google scaling study, Anthropic multi-agent system, Adaptive Submodularity, Bandits with Knapsacks, LLMCompiler, ADaPT); đối chiếu với Phase 1 ở mục 5.3.1.
- `docs/design/2026-10-12-p4-system-optimization-research.md` — quyết định 2026-10-13 (mục 4 đối chiếu ở trên), sự cố self-DoS wedge (mục 2.4).
- `docs/adr/0021-b0-session-isolation-gate.md`, `0023-bounded-iterative-surface-reexpansion.md`, `0026-bounded-parallel-surface-fanout.md` — cơ sở ban đầu cho ceiling=3, chưa xét rủi ro phía target.
- `docs/adr/0067-enforce-dispatch-concurrency-ceiling.md` — Phase 0, ceiling thật do code enforce.
- `docs/adr/0068-data-driven-coverage-matrix-trigger.md` — Phase 1, trigger theo dữ liệu thay cho chữ "Initial Foothold".
- `packages/raptix/raptix/intelligence/agents/standard/_surface_registry.py`, `_surface_reexpand.py`, `_surface_dispatch.py`, `packages/raptix/raptix/knowledge/graph/tools.py` (`kg_surface_inventory`), `packages/raptix/raptix/middleware/dispatch.py`, `packages/raptix/raptix/intelligence/prompts/standard/raptix.md` — code liên quan trực tiếp.
