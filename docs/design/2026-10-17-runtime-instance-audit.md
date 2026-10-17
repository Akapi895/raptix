# P10a audit: runtime instance identity, roster and messaging

- **Ngày:** 2026-10-17.
- **Phạm vi:** chỉ đọc code. Không đổi runtime, không chạy model, không gửi request tới target.
- **Mục đích:** trước khi viết P10b–P10e, xác định nguồn định danh có sẵn, phần nào không thể suy ra từ runtime, và điểm nào cần quyết định trước khi làm.
- **Nguồn đọc:** `packages/raptix/raptix/middleware/dispatch.py`, `core/dispatch_context.py`, `core/subagent_streaming.py`, `execution/workers/runner.py`, `interfaces/api/checkpointer.py`, `langgraph.json`, `middleware/hitl.py`, `execution/tools/interaction/ask_user.py`, và log container `raptix-langgraph`.

## 1. Những gì runtime đã có

| Khái niệm | Nơi có | Ghi chú |
|---|---|---|
| Dispatch identity | `middleware/dispatch.py` (`dispatch_id`, `objective_id`, `attempt`) | `dispatch_id` là giá trị truyền vào hoặc fingerprint của role, objective và mô tả. `attempt` tăng dần theo `dispatch_ledger` trong state của graph. |
| Ledger | `runtime.state["dispatch_ledger"]` | Nằm trong state của graph, nên được checkpoint theo thread. Đây là nguồn bền vững đầu tiên cho roster. |
| Scope của dispatch | `configurable.thread_id` | Mỗi thread có một ledger riêng. Giới hạn `MAX_DISPATCHES` theo thread. |
| Admission và concurrency | `self._active`, `_in_flight_units`, `_resilience` trong bộ nhớ | Không bền. Mất khi restart. |
| Transcript subagent | `core/subagent_streaming.py`, reducer `SubagentTranscriptState` | Transcript được cắt (cap) khi ghi vào checkpoint của cha. |
| Gọi subagent | Tool `task` (`dispatch.py:456, 524`) | Subagent chạy đồng bộ bên trong một lần gọi tool của graph cha. |
| Hỏi người dùng | `interrupt()` trong `execution/tools/interaction/ask_user.py` | Đây là cơ chế resume của graph question, không phải pause. |
| Checkpointer | `langgraph.json` → `interfaces/api/checkpointer.py` (`AsyncSqliteSaver`) | Đường dẫn SQLite nằm trong container `raptix-langgraph`. |

## 2. Kết luận chính

1. **Child không có địa chỉ riêng.** Subagent là một invocation đồng bộ trong tool call `task` của parent. Không có thread, run hay inbox riêng để gửi tin nhắn tới một child đang chạy.
2. **Không có safe-point để giao tin nhắn.** Nếu muốn giao tin cho child đang chạy, phải hook vào giữa các bước model/tool của child. Hook này chưa tồn tại. Theo plan §P10c: không dùng in-memory queue rồi gọi là durable.
3. **Dispatch ledger đủ để làm roster ở mức đọc.** Mỗi dispatch có `dispatch_id`, `attempt`, `objective_id`, outcome và thread. Đây là nguồn chứng minh cho instance identity. Không được tạo parent/run cho event cũ thiếu nguồn.
4. **Runtime không bền khi restart chưa được chứng minh.** Log `raptix-langgraph` cho thấy `langgraph_runtime_inmem.queue`, tức là dev runtime dùng queue trong bộ nhớ. Checkpointer SQLite có persist qua restart hay không phụ thuộc vào việc file có nằm trên volume không. Cần test restart trước khi tuyên bố durable.
5. **Pause và cancel theo child chưa được hỗ trợ.** Cancel run của cha đã có. Không có cơ chế dừng một child đang nằm trong tool call mà không ảnh hưởng cha.

## 3. Quyết định cần chốt trước khi viết code

| ID | Câu hỏi | Đề xuất |
|---|---|---|
| R1 | Nguồn instance identity | `(threadId, dispatch_id, attempt)` từ ledger. Event không có `dispatch_id` hiển thị là `unknown`. |
| R2 | Roster | Đọc từ `dispatch_ledger` của thread, không copy state child. Thêm cursor theo `attempt` và `dispatch_id`. |
| R3 | Giao tin nhắn cho child đang chạy | Chưa có safe-point. P10c bị `blocked` cho tới khi có hook; không thay bằng queue in-memory. |
| R4 | Retry | Tạo attempt mới trong ledger, giữ lineage qua `dispatch_id`. Đây là hành vi hiện có. |
| R5 | Cancel một child | `unsupported` có tên. Cancel run của cha vẫn là đường duy nhất. |
| R6 | Durability | Test restart: tạo dispatch, restart `raptix-langgraph`, đọc lại ledger. Chỉ khi đó mới xác nhận roster bền. |

## 4. Trạng thái triển khai

- **P10b (roster đọc từ ledger):** khả thi. Cần endpoint đọc mới, không đổi hành vi dispatch.
- **P10c (inbox/outbox, forward):** blocked theo R3.
- **P10d (cancel/retry/reassign):** retry và reassign dùng attempt mới đã có. Cancel riêng cho child là unsupported theo R5.
- **P10e (browser/API):** chỉ làm sau P10b, và chỉ hiển thị những gì runtime trả về.

## 5. Kiểm tra cần có khi triển khai

- Deterministic graph test với hai dispatch cùng role: ledger tách đúng hai instance.
- Restart test: roster còn nguyên sau khi restart `raptix-langgraph`.
- Legacy: event không có `dispatch_id` không được gán parent hay run.
