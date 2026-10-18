# Việc còn lại theo phase (P00–P13)

- **Ngày cập nhật:** 2026-10-18
- **Repository HEAD khi cập nhật:** `953a4bea`
- **Nguồn đối chiếu:** `docs/design/2026-10-17-web-ui-contract-completion-implementation-plan.md` (§6 định nghĩa phase, §13 ledger đến 13.24), ADR-0089, ADR-0090, và registry `apps/web/src/real/service-adapter/control-gaps.ts` (hiện 3 mục).
- **Quy ước trạng thái:**
  - *Xong*: có code, có test/bằng chứng, không còn việc bắt buộc của phase.
  - *Một phần*: có phần chạy được, còn acceptance hoặc phần việc bắt buộc.
  - *Chưa*: chưa có implementation.
  - *Hoãn*: exclusion đã được người yêu cầu ghi nhận có tên.
  - *Blocked*: cần quyết định hoặc tài nguyên bên ngoài.
- **Phân công:** mục đánh dấu **[UI]** thuộc session `ui-ai-workspace` (đang làm giao diện AI workspace), không làm trong session backend.

## 1. Bảng tổng hợp

| Phase | Trạng thái | Còn thiếu chính |
|---|---|---|
| P00 | Một phần | Inventory 55 key và tabs/actions (real/shared/mock-only); dirty-file ledger; image digest cho baseline. |
| P01 | Gần xong | Test abort và late-ACK ở transport đã có (`43efd4c4`, 14 test pass). Còn test cho port/adapter. |
| P02 | Một phần | A01: artifact runtime thật từ một dedicated run. |
| P03 | Một phần | Browser: retry attach sau lỗi. |
| P04 | Một phần | Browser: tamper, traversal/symlink, mất quyền, interrupted download. |
| P05 | Một phần | Browser: vòng đầy đủ hai actor kèm một refusal. Xác minh `finding.auditTrail`, `finding.reportLink` đã nối UI **[UI]**. |
| P06 | Một phần | Browser: hai actor sửa/duyệt (A07). `report.projectInfo` nối UI **[UI]**. |
| P07 | Một phần | PDF/DOCX **Hoãn** (D05, exclusion có tên). Phần còn lại xong. |
| P08 | Xong (code) | Còn 3 mục registry (§3). |
| P09 | Gần xong | Mục mock-only **[UI]**; parity checklist theo domain; 7 test theo thời gian chưa ổn định. |
| P10 | Một phần | Forward live; hai instance cùng role đồng thời live. DTO instance đã vào `@raptix/web-contracts` (`637e9bb0`). Câu hỏi của instance được pin trong messenger (`dd837e6d`). Retry/forward dùng intent id giữ qua ACK bị mất (`b0309394`). |
| P11 | Một phần | Backend và UI pause/resume/complete đã nối (`e4ca7f67`), chưa có acceptance live cho từng nút. Còn: step controls (read-only mapping là bước trung gian); acceptance deterministic và live (§2, P11). |
| P12 | Một phần | Còn: Results/Trace; C2 round-trip Sliver trong Docker lab; lifecycle UI **[UI]**. Campaigns generate/deploy **Blocked** (ROE loại phishing). |
| P13 | Chưa | Chờ P09–P12; build/digest/evidence tổng hợp; dọn panel/contract/gate cũ. |

Ngoài phase: browser click-through của luồng chính chưa chạy (phiên không có browser tool); sandbox per-project cho project mới phải provision thủ công (§4).

## 2. Chi tiết theo phase

### P00 — Khóa inventory, contracts và acceptance baseline
- **Đã có:** ADR-0087/0088 Accepted; D01–D08 ghi nhận trong ledger §13.1.
- **Còn thiếu:**
  - Inventory 55 key và các project tabs/modals/header actions, phân loại real/shared/mock-only và owning port.
  - Phân loại gap theo UI / API / deployment / evidence.
  - Dirty-file ledger và image digest/revision cho lượt baseline.
- **Acceptance còn mở:** mapping feature/action → test selection cho PR đầu.

### P01 — Hoàn thiện feature ports và real transport
- **Đã có:** `EvidenceUploadInput` có bytes; transport binary kiểm độ dài và SHA-256 (ledger 13.15).
- **Đã có thêm (`43efd4c4`):** test transport: response đến sau khi caller đã abort hoặc chuyển engagement bị bỏ.
- **Còn thiếu:** test abort và late-ACK ở tầng port/adapter, phía trên transport.

### P02 — Producer findings → shared suggestion/import flow
- **Đã có:** route suggestions/import/options; dismissal theo actor + path; migration `20261022`; gate `p02-p05-workflow-live.ts` pass (import idempotent khi retry đồng thời).
- **Còn thiếu:** A01 cần một artifact runtime thật từ dedicated run. Informational marker không được ghi là vulnerability.

### P03 — Evidence upload + attach có recovery
- **Đã có:** capture session, upload UI, route captures và attach; gate pass (attach capture chưa phân loại đã được sửa theo ADR-0087).
- **Còn thiếu:** kiểm retry attach sau lỗi (capture đã lưu, attach lỗi) trên browser.

### P04 — Evidence original bytes, preview/download và integrity
- **Đã có:** route `GET artifacts/captures/:id/content`; SHA-256 ở adapter; đổi nhãn "Download original".
- **Còn thiếu:** browser cho tamper, traversal/symlink, mất quyền, interrupted download; kiểm file tải thật và digest.

### P05 — Findings model/lifecycle đầy đủ
- **Đã có:** migration `20261024`; comments, retests, activity, references; retest rule theo quyết định người yêu cầu; gate pass; ADR-0088 Accepted.
- **Còn thiếu:**
  - Vòng đầy đủ hai actor trên browser (draft → review → confirmed → remediation → retest → resolved), kèm một refusal.
  - `finding.auditTrail` và `finding.reportLink` **[UI]**: ledger 13.15 ghi backend có nhưng chưa nối UI. Registry không còn entry, nên cần kiểm lại trên browser trước khi coi là đã nối.

### P06 — Report composition, options và review readiness
- **Đã có:** template có version; kỳ báo cáo; reviewer được đặt tên; snapshot finding theo version; readiness tính ở server; lineage khi revise; gate `p06-report-composition-live.ts` pass.
- **Còn thiếu:**
  - Live hai browser sửa/duyệt (A07): approved content không drift khi finding đổi.
  - `report.projectInfo` **[UI]**: backend có, chưa nối UI; kiểm lại như P05.

### P07 — PDF/DOCX export, delivery và acknowledgement riêng
- **Đã có:** acknowledgement tách biệt khỏi delivery, idempotent theo request id; JSON/Markdown export giữ nguyên.
- **Hoãn:** PDF/DOCX theo quyết định người yêu cầu (D05). UI hiển thị `unavailable`, không giả PDF.

### P08 — Khép shared Findings/Evidence/Reports tại mọi entrypoint
- **Đã có:** project tab và standalone dùng `ReportsPage`/`FindingList` chung; đã xóa `RealReportsPanel`, `RealReportEditor`, `RealReportSetup`, `RealFindingsPanel` và test tương ứng (commit `8a03dd0`).
- **Còn trong registry (3 mục):** xem §3.
- **Lưu ý:** ledger 13.15 ghi 8 mục; sau P08 còn 3.

### P09 — Assets/Library và administrative UI dùng chung
- **Đã có:**
  - Assets (`59b8694`), Library (`a222392`).
  - Scope & ROE, Team, Settings, Vault, Audit, Closure, Analysis, Planning, Governance, Notices: có port và panel/tab dùng chung. Inventory đã xóa.
- **Còn thiếu:**
  - **[UI]** Mục mock-only: inbox phê duyệt trong tab Team & Approvals của mock, plan review mock (`g-plan`), session console mock (`h-session`, `c-console`) mới chỉ đổi lời gọi sang port.
  - Parity checklist theo domain (exit §6 P09): chưa có bằng chứng "không còn unique action ở real panel cũ".
  - Vitest toàn bộ 1285/1292 (ledger 13.19); 7 test theo thời gian chưa ổn định (RealProjectCreateDialog, a11y/dark-theme/responsive audit, copilot drawer).

### P10 — Runtime instance identity, inbox/history và controls
- **Đã có (live trên lab 10.129.227.140, ledger 13.22–13.23):**
  - Roster đúng instance/attempt/role; history attempt được giữ.
  - Message: `accepted → delivered → handled (model_turn_completed)` trên attempt đang chạy.
  - Cancel cooperative: `cancel_requested` tách biệt với `cancelled` observed; ledger khớp mailbox.
  - Retry có grant và chạy đúng persisted intent (cùng dispatch, intent 1635 ký tự trùng); reassign sang role khác tạo dispatch mới.
  - Restart runtime lúc attempt chạy: attempt → `interrupted`, message → `undelivered/instance_interrupted`; durability mailbox giữ nguyên.
  - Parent stop: attempt con `interrupted`, message chờ `undelivered`, run cha `interrupted`.
  - Question của planning (soundwave): pending interrupt → resume bằng `questionId` → run success.
- **Đã có (code + test):** ADR-0089, ADR-0090; grant store; chặn redispatch sau cancel và sau interrupt (`cancelled_intent`, `interrupted_intent`); cô lập mailbox; `test_instance_cases.py` (sibling isolation, cancel trong model call, cancel tại boundary kế tiếp, parent stop); test dispatch-level hai dispatch cùng role giữ ledger row và mailbox instance riêng (`135390d1`).
- **Còn thiếu:**
  - **Forward live:** cần attempt đích đang chạy trên cùng thread. Run 1 của kịch bản bị treo do vòng `sleep` của model, nên run 2 bị 409. Attempt A đã nhận message `handled`. Chưa có forward live.
  - **Hai instance cùng role đồng thời live:** model dispatch tuần tự dù được yêu cầu song song. Cần prompt/tool buộc concurrency, hoặc chấp nhận là blocked.
  - **Pin câu hỏi trong messenger [UI]:** execution assistant không có tool `ask_user`; mới kiểm chứng ở planning. Messenger chưa liệt kê câu hỏi pinned; batch resume giữ nguyên.
  - **DTO instance** đã chuyển vào `@raptix/web-contracts` (`src/instances.ts`, `637e9bb0`) như ADR-0089 yêu cầu. `api.ts` re-export cho màn hình; `run-service.ts` import từ contracts. DTO lệnh (`InstanceCommandAck`, `InstanceCommandView`) chưa chuyển.
  - Lineage reassign chỉ có trong run message, chưa có bảng riêng (ADR-0089 không yêu cầu; ghi nhận như hạn chế).

### P11 — Operations lifecycle và step controls tại runtime
- **Đã có (backend + live, ledger 13.24):**
  - Pause: ghi `pause_requested` trước khi cancel ở safe point; `paused` chỉ khi runtime báo run `interrupted`.
  - Resume: run mới trên cùng thread với `input: null` (tiếp tục checkpoint, không gửi prompt cũ). Gate plan vẫn chạy; tin nhắn mới bị từ chối khi paused/completed.
  - Complete: audit `operation.completed` sau khi run terminal, không còn instance chạy, không còn request uncertain; run lỗi giữ nguyên status.
  - Live trên lab: pause → `paused`; tin nhắn khi paused bị 409; resume → run `success`, không có user message mới; file output có `part1` và `part2` mỗi phần một lần (không side effect lặp); complete khi run còn active → 409; complete sau khi xong → 200, audit ghi.
  - Test: `run-operations.test.ts` (7 test: pause cần run đang chạy, pause ghi intent trước khi cancel, confirm paused chỉ khi interrupted, complete bị chặn khi instance còn chạy, complete ghi audit, resume cần paused, submit bị chặn khi paused).
- **Còn thiếu:**
  - **UI controls [UI]:** nút pause/resume/complete trong Operations (tab hiện nói rõ chưa có).
  - **Step controls:** review/approve/return/skip theo step identity. Chưa có step model trong runtime; OPPLAN objectives là ứng viên. **Cần quyết định mapping.**
  - **Acceptance chưa chạy:**
    - Restart runtime khi đang paused (paused restart).
    - Pause khi đang có question pending (question-vs-pause).
    - Stop race (emergency stop đồng thời với resume).
    - Approval deadline: deadline−1/0/+1 của plan.
    - Stale token/version và double resume đồng thời (đã kiểm: resume lần hai sau khi chạy trả 409; chưa kiểm đồng thời).
    - Pause riêng cho child dispatch đang chạy (đã có parent stop, chưa có pause child).

### P12 — C2 và Operations presentation migration
- **Đã có:**
  - Bước 1: `h-session` và `c-console` đi qua port; clock nằm trong mock adapter.
  - C2 provider: port, adapter, tab dùng chung (grants, listeners/profiles, console, session routes). Provider không cấu hình trên deployment này; banner hiển thị đúng.
  - **C2 grant verification (`2942658a`, `af1befa6`):** grant request và approve đều hỏi provider (`sessions.list`) và từ chối session không được báo cáo; provider chưa cấu hình trả 503. Dispatch vẫn kiểm session qua `sessions.get` như trước.
  - Operations: tab thread/run/timeline/cancel dùng chung (live 8/8).
  - Fleet: tab dùng port runtime (live 4/4). Latency `/fleet` khoảng 5 giây mỗi lần đọc; ghi nhận, chưa tối ưu theo quyết định.
  - Campaigns: giữ route thật có tên; listeners/profiles đã nằm trong C2 tab; generate/deploy giữ nguyên.
- **Còn thiếu:**
  - **Results và Trace:** chưa có real panel **[UI]**; chưa có adapter từ runtime history/events (phần adapter là backend, có thể làm trước). Quyết định: phải hoàn thiện, không chuyển thành mock-only.
  - **C2 round-trip live:** quyết định cho phép Sliver/bridge trong lab Docker cục bộ, không đưa lên 10.129.227.140. Chưa dựng (image `raptix-iw09-sliver-bridge:lab` có sẵn). Đây là acceptance còn mở, không phải exclusion.
  - **Lifecycle controls của Operations [UI]:** chờ UI của P11.
  - **Campaigns generate/deploy: Blocked.** Quyết định: không engagement nào được duyệt cho phishing hoặc social engineering; không chạy GoPhish/Evilginx để phishing. Giữ retained routes; acceptance live ghi blocked có tên.

### P13 — Final integration, cleanup và acceptance ledger
- **Chưa làm.** Chờ P09–P12 (theo required scope).
- **Còn thiếu:** reconcile inventory 55 key; build UI/API/runtime với source revision, tree digest và image ID; migration trên dedicated DB; chạy acceptance còn thiếu §9–§10; dọn deprecated panels/contracts/gates; cập nhật tracker và runbook.

## 3. Registry gap hiện tại (3 mục)

| Key | Lý do | Phase liên quan | Trạng thái |
|---|---|---|---|
| `evidence.original` | Legacy evidence không có retained capture | P04 | Giới hạn dữ liệu (không phải code thiếu) |
| `evidence.integrity` | Legacy evidence không có digest để verify | P04 | Giới hạn dữ liệu |
| `report.pdfDocx` | PDF/DOCX chưa render | P07 | **Hoãn** (D05, exclusion có tên) |

## 4. Việc phát sinh ngoài plan

- **Sandbox per-project cho project mới (ADR-0086):** project mới không có container `sbx-<slug>` cho đến khi chạy `raptix web sandboxes sync`. Khi thiếu, planner kẹt im lặng vì mỗi tool sandbox retry 150 giây (không có event trên UI). Đã sửa launcher (`b4bef5c1`): volume đúng và không xóa sandbox khi listing rỗng. **Còn mở:** preflight báo sandbox thiếu; project tự provision hoặc run fail nhanh với thông báo rõ.
- **Retry 150 giây mỗi tool call của sandbox:** quá dài, làm UI im lặng. **Còn mở:** fail nhanh và đưa lỗi thành event hiển thị được (quyết định thiết kế, chưa đổi).
- **HITL bash approval:** runtime bật `RAPTIX_HITL__REQUIRE_BASH_APPROVAL=1`, mỗi lệnh bash chờ operator (timeout 300 giây, mặc định deny). Trong các test live, duyệt bằng script chỉ cho lệnh cục bộ. **Còn mở:** duyệt trên UI cho luồng chính.
- **Browser click-through của luồng chính:** chưa chạy. Các API đằng sau từng bước đã kiểm chứng (ledger 13.23–13.24). **Còn mở:** cần browser để xác nhận UI.
- **Phối hợp trên cùng checkout:** session UI sửa file trong `apps/web/src`. Có thời điểm các file runtime Python (`instance_mailbox.py`, `dispatch_context.py`, `dispatch.py`, `plugins_api.py`) bị sửa bởi phiên khác (thêm `parent_dispatch_id`), chưa commit. Không thuộc phần đã nêu ở đây; cần đối chiếu trước khi commit runtime.
- **Dev-server reload trên stack nghiệm thu:** đã tắt (`--no-reload`, `ca928fad`).

## 5. Commit liên quan (từ 2026-10-18)

| Commit | Nội dung |
|---|---|
| `66f40077` → `fb3e3df1` | P10c/P10d/P10e: mailbox pin attempt, cancel, forward, controls, ledger 13.21 |
| `5096b969` | Ledger 13.22: live P10 và blocker |
| `075eedbb` | Identity run và bash fence không pin (ADR-0090) |
| `42af01b0` | Operator grant cho cancelled intent |
| `0cc2fa67` | Retry/reassign qua grant, không rewrite prompt |
| `767f12ac` | OPPLAN load giữ identity đáng tin |
| `ca928fad` | Acceptance runtime chạy `--no-reload` |
| `66689bc3` | Interrupted intent không replay tự động |
| `de37925c` | Settle run kết thúc chưa quan sát trước khi reserve run mới |
| `b8ee5ac4` | Ledger 13.23: luồng chính live |
| `b4bef5c1` | Launcher sync: volume đúng, không xóa sandbox khi listing rỗng |
| `72ccc1c9` | P11: pause, resume, complete qua runtime checkpoint (backend) |
| `2c06098e` | P11: gate plan chấp nhận paused; tin nhắn mới bị chặn khi paused/completed |
| `2942658a`, `af1befa6` | P12: C2 grant yêu cầu session do provider báo cáo; test |
| `135390d1` | P10: test deterministic hai dispatch cùng role |
| `b0309394` | Messenger giữ một intent id qua ACK bị mất; gửi lại kiểm tra mailbox trước |
| `b290b208` | Server quyết định `canManage` theo người gọi; owner không còn bị khóa invite |
| `e4ca7f67` | P11: pause run, resume operation, mark complete trên tab Operations |
| `dd837e6d` | P10: câu hỏi của instance được pin trong messenger |
| `43efd4c4` | P01: test late-ACK sau abort ở transport |
| `637e9bb0` | P10: DTO instance chuyển vào `@raptix/web-contracts` |
| `953a4bea` | Ledger 13.24 và file này (phiên trước) |

## 6. Thứ tự đề xuất để đóng phase

1. **Backend, không chờ UI:**
   - P10: forward live; hai instance đồng thời (cần prompt/tool buộc concurrency hoặc quyết định blocked).
   - P11: acceptance còn lại (paused restart, question-vs-pause, stop race, approval deadline, double resume đồng thời).
   - P12: Results/Trace adapter từ runtime history/events; C2 lab round-trip (Sliver trong Docker cục bộ, cần quyết định).
   - P01: test late-ACK ở tầng port/adapter (transport đã có).
   - P00: inventory 55 key.
2. **Quyết định cần từ bạn:**
   - P11 step controls: mapping step ↔ OPPLAN objective.
   - P10 hai instance đồng thời: chấp nhận blocked hay đổi prompt/tool.
   - P12 C2 lab: xác nhận dựng Sliver trong Docker cục bộ.
3. **UI [session ui-ai-workspace]:** nút pause/resume/complete; pin câu hỏi trong messenger; Results/Trace panel; lifecycle controls; mục mock-only P09; xác nhận `finding.auditTrail`, `finding.reportLink`, `report.projectInfo` đã nối.
4. **Browser:** P02–P06 acceptance trên browser; luồng chính click-through; duyệt bash trên UI.
5. **P09 parity:** checklist theo domain.
6. **P13:** cuối cùng, sau khi các phase trên có bằng chứng.
