# Implementation plan — Execution: hội thoại và điều hành subagent

- **Trạng thái:** Đã chốt hướng UX; chưa triển khai qua tài liệu này.
- **Ngày:** 2026-10-16.
- **Quyết định:** giữ tên **Execution**; hội thoại ở giữa; cột phải hiển thị cây
  agent được spawn, thông tin chi tiết và các thao tác được hỗ trợ.
- **Tiếp nối:** [Project Workspace UI](2026-10-16-web-project-workspace-ui-implementation-plan.md).
- **Ưu tiên:** UI mock trước; kiểm tra capabilities và tích hợp real theo khả năng có thật.

## 1. Mục tiêu sản phẩm và quan hệ với plan trước

Execution là phòng điều hành của project, không chỉ là danh sách operation/run.
Người dùng phải thấy được hệ thống đang chia việc cho ai, từng agent đang làm gì,
đang cần thông tin nào, và có thể giao tiếp hoặc can thiệp đúng đối tượng.

Plan này làm rõ **giai đoạn 3 — Execution** của Project Workspace UI. Các quyết
định shell, sidebar theo nhóm và Scope/document workspace ở plan trước vẫn giữ.
Nếu có mô tả cũ xem chat là một trang phụ bên ngoài Execution, dùng bố cục trong
plan này làm đích UX. Không tạo thêm mục sidebar “Runs” hoặc một AI Workspace độc
lập trùng chức năng. Lịch sử thực thi và lựa chọn hội thoại nằm bên trong Execution.

Đường vào chính:

```text
PREPARATION
  Scope & ROE
  Planning

EXECUTION
  Execution
  C2 Sessions
```

Planning tiếp tục là nơi làm việc với planner và bộ tài liệu. Nó có thể tái dùng
component hội thoại, nhưng giữ thread kind/assistant/context riêng. C2 Sessions
là phiên kết nối tới môi trường đích, không phải hội thoại AI.

## 2. Phạm vi và nguyên tắc triển khai

### UI-first

- Thiết kế và thực hiện bố cục, selection, luồng chat, câu hỏi, trạng thái điều
  khiển và fixture mock đủ dùng để người vận hành review trực tiếp.
- Mock thể hiện rõ là mô phỏng. Mutation đi qua mock authority/feature handlers,
  không tạo store agent thứ hai không đồng bộ với phần còn lại của console.
- Real reuse thread/run/request-ledger/SSE và query hiện có; thiếu nguồn hoặc
  thao tác thì có trạng thái unavailable/read-only rõ ràng, không lấy mock bù vào.
- Không sửa thuật toán fan-out, quy tắc spawn/admission, tool selection, exploit,
  worker scheduler hoặc cách các agent phối hợp trong runtime.
- Không đổi RoE, approval, handoff, preflight, authorization, cancellation semantics.
  Chat không phải một đường vòng để vượt qua các cơ chế đó.
- Không thêm dependency graph/chat UI lớn khi component hiện có đáp ứng được.

**Nhu cầu đích là giao tiếp và kiểm soát subagent thật.** UI mock pass chỉ chốt
trải nghiệm; chưa được báo tính năng real hoàn tất nếu runtime chưa có đúng
identity, delivery hoặc control contract. API/runtime mới là dependency riêng,
cần Proposed ADR/contract review theo quy định repo, không suy ra đã có từ tên event.

## 3. Bố cục Execution đã chốt

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Header project gọn · trạng thái · điều khiển chung · account             │
├────────────────┬──────────────────────────────────┬─────────────────────┤
│ Sidebar project│ Execution                       │ AGENTS | CONTEXT    │
│ theo nhóm      │ Đợt thực thi / lịch sử            │                     │
│                │ Đang trao đổi với: Raptix         │ Raptix              │
│ Execution      │ hoặc Recon #2                     │ ├─ Recon #1         │
│ đang active    │                                  │ ├─ Recon #2 [Chờ bạn]│
│                │ Hội thoại · câu hỏi · hoạt động   │ └─ Exploit #1       │
│                │ có nguồn, đúng agent/thread       │                     │
│                │                                  │ Chi tiết lựa chọn   │
│                │ Gửi tới [đối tượng rõ ràng]        │ Objective / actions │
└────────────────┴──────────────────────────────────┴─────────────────────┘
```

- Trên desktop rộng, cột phải mặc định mở tab **Agents**. Cho resize/thu gọn;
  không làm vùng chat mất chiều rộng tối thiểu. Agent cần người xử lý vẫn có
  badge/entry truy cập được khi panel thu gọn.
- **Context** là tab kế bên: phạm vi, tài liệu, plan, evidence của project và
  execution đang chọn. Không dùng nó thay cho hoặc che mất danh sách agent.
- Lịch sử conversation/execution mở qua selector/drawer, không thêm một sidebar
  thường trực thứ hai cạnh sidebar project rồi ép chat vào giữa nhiều cột.
- Tablet/mobile: panel phải mở thành drawer hoặc view chuyển đổi, giữ selection;
  composer và câu hỏi vẫn dùng được. Đóng drawer trả focus về trigger.
- Tên “Execution” giữ ở nav. Run/thread/request IDs nằm trong Details hoặc link
  sao chép; tên mục tiêu và đối tượng hội thoại là thông tin chính.

## 4. Cột phải: cây agent instance và chi tiết

### Identity và phạm vi hiển thị

- Hiển thị **instance**, không chỉ loại agent. Hai Recon được spawn là hai hàng
  khác nhau, ví dụ Recon #1 / Recon #2 kèm ID ngắn khi cần phân biệt.
- Key selection/event dùng identity ổn định từ nguồn, có project và execution/
  thread scope. Không dùng nhãn “Recon” làm khóa, không gộp mọi lần gọi cùng tên.
- Spawn tree và dependency graph là hai quan hệ khác nhau: indentation theo
  parent spawn; dependency/blocked-by hiện trong chi tiết, không tự biến thành parent.
- Cây mặc định theo đợt execution đang chọn. Agent lịch sử/đợt khác tách rõ;
  không trộn agent hoàn tất từ lần chạy trước vào live roster của lần hiện tại.
- Khi nguồn thiếu instance/parent identity, hiện event chưa gán/parent unknown;
  không dựng cây có vẻ chính xác từ agent name hoặc namespace chưa được kiểm chứng.

### Nội dung mỗi hàng

Vai trò/tên instance, objective ngắn, trạng thái, hoạt động gần nhất và chỉ báo
“cần bạn”. Chi tiết mở rộng có target/scope reference, parent, dependencies,
assistant/model nếu có nguồn, timestamps/freshness, output/evidence links.

Trạng thái UI: queued, running, waiting for you, blocked, completed, failed,
cancelled, unknown. Giữ raw status trong Details. Ánh xạ phải dựa vào nguồn:

- Không coi “không nhận event” là completed/failed; mất stream → observation stale.
- `waiting for you` chỉ khi có câu hỏi/decision thuộc instance đó; không đổi mọi
  trạng thái waiting thành yêu cầu người dùng.
- Progress chỉ hiện khi có thước đo thực; không tạo % từ số tin nhắn/tool events.
- Agent cha hoàn tất không tự xác nhận mọi con đã kết thúc; thiếu dependency
  vẫn là missing, không được coi là satisfied.

Cây giữ thứ tự/selection ổn định khi update, không tự nhảy hội thoại mỗi lần
agent mới spawn. Dùng filter hoặc vùng Needs attention cho agent cần xử lý thay
vì liên tục sắp xếp toàn bộ danh sách làm người dùng mất vị trí. Danh sách dài
có expand/collapse; keyboard dùng được và không chỉ phân biệt trạng thái bằng màu.

## 5. Chọn agent và giao tiếp

1. Mặc định chọn orchestrator Raptix của execution hiện tại.
2. Bấm subagent → vùng giữa hiển thị hội thoại/hoạt động của đúng instance;
   tiêu đề và composer cùng chỉ rõ người nhận.
3. Quay về orchestrator qua một entry luôn tìm được, giữ draft của từng đối tượng.
4. Mỗi tin nhắn hiển thị sender, recipient và delivery path có thật; không đổ
   toàn bộ tool logs của các agent vào cùng transcript không phân nguồn.

### Ba mức hỗ trợ real cần thể hiện minh bạch

| Capability của instance | Giao diện |
|---|---|
| Chỉ quan sát | Đọc activity/output; composer read-only, lý do rõ |
| Chỉ nhận chỉ dẫn qua orchestrator | Composer ghi **Gửi chỉ dẫn qua Raptix cho Recon #2**; có parent conversation/link và trạng thái forward; không giả chat trực tiếp |
| Có kênh giao tiếp trực tiếp | Composer ghi **Gửi tới Recon #2** và dùng đúng instance/thread contract được runtime hỗ trợ |

Việc runtime tạo subagent không tự chứng minh subagent có endpoint chat, checkpoint
thread riêng hoặc có thể nhận tin nhắn trong lúc đang chạy. Trước khi bật composer
real, xác minh delivery semantics: gửi ngay, queue tới checkpoint, hay chỉ trả lời
được interrupt. Cho người dùng thấy queued/delivered/failed theo ACK thực tế.

- Nội dung cần hỗ trợ ở UX: trả lời câu hỏi, bổ sung context/evidence, yêu cầu giải
  thích và gửi chỉ dẫn thêm. Mở agent đã hoàn tất không tự spawn/re-run để trả lời;
  chỉ cho phép kênh còn hoạt động hoặc chuyển yêu cầu qua orchestrator rõ ràng.
- Câu hỏi có question/interrupt identity, người nhận, input phù hợp và trạng thái
  đã trả lời. Không trả lời câu hỏi agent A bằng thread/resume identity của agent B.
- Tool approval/decision là control card riêng, giữ quyền và domain semantics;
  không gửi text “approve” rồi trình bày như decision chính thức đã ghi nhận.
- Draft key theo actor/project/execution/instance/conversation. Đổi agent giữ
  draft đúng người nhận; gửi phải capture target lúc submit, không dùng selection
  mới nếu người dùng bấm sang agent khác giữa request.
- Pending/uncertain ACK dùng recovery/idempotency hiện có khi tương thích.
  Không gửi lại để đoán kết quả, không biến request replay thành lần dispatch mới.

## 6. Điều khiển agent và execution

Control nằm trong chi tiết agent/cụm action, tách khỏi composer. Hiển thị theo
capability + quyền + trạng thái, không mặc định mỗi agent đều pause/cancel được.

| Action UX | Yêu cầu thể hiện |
|---|---|
| Pause / Resume | Phân biệt pause riêng instance với pause cả execution; chỉ bật đúng contract |
| Cancel task | Chỉ rõ instance và ảnh hưởng đã biết tới children/dependencies; không hứa hủy toàn cây nếu runtime không bảo đảm |
| Retry / Reassign | Là hành động mới có liên kết tới attempt trước, không đổi attempt cũ thành “đang chạy” hoặc âm thầm tái dispatch |
| Stop execution/project | Phạm vi điều khiển chung, khác cancel một agent; dùng stop workflow hiện hành |

- Các control chưa có contract trong real: ẩn hoặc disabled kèm lý do, không thêm
  nút có vẻ hoạt động nhưng chỉ đổi state frontend.
- Phản hồi: requested → pending acknowledgement → observed outcome; request thành
  công không có nghĩa agent đã dừng. Nếu mất ACK giữ unknown/recovery.
- Giữ reason/confirmation khi workflow hiện hành yêu cầu. Trạng thái race “agent
  vừa hoàn tất trước khi cancel” phải phản ánh observed state, không ghi đè bằng
  một trạng thái optimistic sai.
- View/selection, mở Context, refresh và reload không gửi control/chat tự động.
- Frontend không dựng khả năng per-agent control bằng cách gọi endpoint cancel
  run toàn cục rồi đổi nhãn thành “Cancel Recon #2”.

## 7. Điểm tái sử dụng và gap hiện tại

Đường dẫn sau tương đối với `apps/web/src/`; đối chiếu working tree khi bắt đầu.

| Nguồn hiện tại | Cách dùng / giới hạn |
|---|---|
| `screens/g-chat.tsx`, `g-workspace.tsx`, `g-common.tsx` | Chat, composer, rail/inspector và resize hiện có; compose lại thành Execution, không nhúng nguyên nhiều page header |
| `screens/g-workers.tsx`, `features/workers/{service,query}` | Mock worker rows/parent/deps/graph là read model; hiện không có worker messaging/control mutations |
| `screens/{c,c-console,c-results}.tsx` | Status/lifecycle/timeline/results hiện hữu; giữ adapter và ownership, không sửa fan-out logic |
| `real/screens/workspace.tsx`, `real/stream.ts` | Owned conversations, request ledger, SSE và câu hỏi; event subagent hiện được chuyển thành trace lines, chưa chứng minh có roster/chat/control per instance |
| `real/screens/{operations-panel,fleet-panel}.tsx` | Runs và observed fleet hiện có; kiểm tra identity/source trước khi dùng để dựng cây |
| `shell/nav.ts`, `router/{host,navigate,history}` | Project shell/active-section và deep links; giữ một location writer và dirty guard |

Mock worker wording cũ mô tả worker chỉ draft/review/summarize; không được mặc
định model đó đại diện đầy đủ cho specialist runtime thực thi. UI mới dùng adapter
phân biệt AI agent instance với host executor AG-xxx, branch task và model/provider.

Gap cần ghi cho real theo bảng `Observed agents / Direct message / Forward /
Answer interrupt / Pause / Cancel / Retry`, mỗi capability có source/endpoint,
scope, quyền, ACK semantics và trạng thái supported/unavailable. Không đánh dấu
“supported” chỉ vì có một trace event tên gần giống.

## 8. Ba giai đoạn lớn

| Giai đoạn | Nội dung gộp | Bàn giao |
|---|---|---|
| **1. Execution shell + Agents panel** | Hợp nhất entry chat/execution; vùng giữa, right panel Agents/Context, identity/selection và roster fixture | Người dùng mở Execution, thấy orchestrator và nhiều instance con, chọn từng instance không mất project context; desktop/mobile dùng được |
| **2. Giao tiếp và control UX** | Recipient/draft, câu hỏi/decision, activity có nguồn, mock messaging/control transitions, capability-gated real presentation | Mock xử lý trọn luồng gửi/queue/lỗi/uncertain và pause/cancel theo instance; real chỉ bật thao tác có contract thật |
| **3. Đồng bộ dữ liệu, recovery và nghiệm thu** | Nối adapter real theo source có sẵn; reload/stream recovery/actor-scope isolation; browser review trên Docker | Bản mock có đủ trạng thái để test; báo cáo real capability gaps chính xác; không thay fan-out/runtime |

Thực hiện **1 → 2 → 3**, deploy mock sau mỗi giai đoạn để người dùng test song
song. Đây là ba hạng mục sản phẩm, không tách thêm ticket cho từng hàng agent/nút.
Nếu diff vượt budget repo, chia PR kỹ thuật theo ownership, mỗi PR một concern,
≤400 runtime lines/≤10 files; không lấy ba giai đoạn làm ngoại lệ cho mega-PR.

Giai đoạn 1 kế thừa Project Shell trong plan trước; không làm lại header/sidebar.
Scope/document workspace có thể được review riêng, Execution dùng các link/context
của nó. Thay đổi source gaps/backend là dependency được ghi lại, không mở rộng vào
công việc fan-out mà người dùng đang sửa song song.

## 9. Nghiệm thu UI và kiểm chứng

| Kịch bản | Kết quả bắt buộc |
|---|---|
| Mở Execution từ project | Một workspace chat + right panel Agents mặc định mở; không có mục Runs hay sidebar thứ hai trùng chức năng |
| Hai Recon cùng loại, khác instance | Hai identity/selection/transcript khác nhau; không gộp theo tên |
| Agent mới spawn/update, agent có children/dependencies | Cây cập nhật không giật selection; parent khác dependency; thiếu nguồn ghi unknown |
| Chọn orchestrator → subagent → Context → quay lại | Đúng target/context; draft từng đối tượng được giữ, không gửi nhầm |
| Gửi trong direct / forward / read-only mode | Nhãn và request path khớp capability; ACK/delivery trung thực; không có direct-chat giả |
| Câu hỏi A và B đồng thời, approval khác câu hỏi | Trả lời đúng identity; decision giữ quyền; câu hỏi cũ/đã xử lý không tiếp tục submit được |
| Agent completed, failed, blocked, mất event stream | Hiển thị khác nhau; không tự rerun/auto-answer; observation stale khác completed |
| Cancel/pause, ACK muộn/mất ACK, agent vừa hoàn tất | Đúng phạm vi control và kết quả quan sát; không báo stopped chỉ vì đã gửi request |
| Reload/reconnect và retry request đang uncertain | Phục hồi từ source/recovery identity; không gửi trùng hoặc tạo agent/run mới |
| Đổi project/actor/execution trong lúc request pending | Không lộ transcript/draft; ACK cũ không retarget selection hoặc điều khiển instance mới |
| Console C2 và host executor | Không bị trình bày như chat AI; link rõ project/resource |
| 1440px/1024px/390px, light/dark, keyboard | Right panel/drawer, focus và composer usable; alert “Chờ bạn” truy cập được khi thu gọn |

Fixture mock tối thiểu: orchestrator; hai Recon cùng role; một agent running;
một waiting-for-user; một blocked dependency; completed/failed/cancelled; source
unknown; hai câu hỏi đồng thời; history từ execution khác. Mô phỏng action trong
authority, không chỉ thay DOM để chụp screenshot.

Chạy focused tests cho workspace/chat, workers projection, stream/request ledger,
scope navigation và các component mới; thấy regression fail trước fix. Tiếp theo
typecheck, lint, build của `@raptix/web-raptix`. Không thay test bằng snapshot chỉ
kiểm tra có chữ Recon; phải assert selection/recipient/request và scope thực tế.

```bash
# Repo root, WSL với Node/npm Linux; build shared packages trước nếu dist thiếu.
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix
npm run test --workspace=@raptix/web-raptix -- --pool=threads --maxWorkers=2 src/real/screens/workspace.test.tsx src/real/stream.test.tsx src/real/request-ledger.test.ts src/features/aichat/query.test.tsx
# Bổ sung owning tests của roster/control và scope đã sửa.
npm run build --workspace=@raptix/web-raptix

docker compose -f docker-compose.web-raptix.yml build --build-arg VITE_DATA_MODE=mock web-raptix-ui
WEB_RAPTIX_PORT=3001 docker compose -f docker-compose.web-raptix.yml up -d --no-deps --wait --wait-timeout 60 web-raptix-ui
```

Browser: **http://127.0.0.1:3001/?dataMode=mock**, hard reload, chọn persona demo.
Test từ Projects → Execution → chọn subagent → gửi/trả lời → đổi agent/project →
reload. Ghi image ID, asset hash, screenshot desktop/mobile và observed requests;
mock không gọi `/api`. Real browser kiểm tra source/capability bằng dữ liệu thật,
không dispatch exploit chỉ để xác nhận bố cục. Không recreate backend/reset DB
chỉ để cập nhật UI, và không giả capability bằng mock trong real.

## 10. Bàn giao và điều kiện hoàn tất

- **UI mock hoàn tất:** bố cục đã chốt, roster/chat/control/recovery states usable,
  các luồng §9 được kiểm chứng trên image `:3001`; người dùng review được trực tiếp.
- **Real observation hoàn tất:** từng instance được định danh và restore từ nguồn
  đáng tin; trace còn thiếu identity được ghi hạn chế, không dựng roster giả.
- **Real communication/control hoàn tất:** chứng minh giao đúng instance hoặc
  forward đúng parent, đúng quyền và ACK; xác nhận phạm vi control thực sự. Thiếu
  contract được ghi dependency, không đánh dấu done từ UI mock.
- Bàn giao theo ba giai đoạn: phần đã chạy, commands/evidence, URL/image hiện tại,
  capability gaps. Cập nhật tiến độ trong tài liệu này khi thực hiện, không tạo
  thêm nhiều plan nhỏ cho từng component.
