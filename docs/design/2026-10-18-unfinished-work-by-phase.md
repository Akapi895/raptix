# Việc còn lại theo phase (P00–P13)

- **Ngày:** 2026-10-18
- **Nguồn đối chiếu:** `docs/design/2026-10-17-web-ui-contract-completion-implementation-plan.md` (§6 định nghĩa phase, §13 ledger đến 13.23), ADR-0089, ADR-0090, và registry `apps/web/src/real/service-adapter/control-gaps.ts` (hiện 3 mục).
- **Repository HEAD khi tổng hợp:** `b4bef5c1`.
- **Quy ước trạng thái:**
  - *Xong*: có code, có test/bằng chứng, không còn việc bắt buộc của phase.
  - *Một phần*: có phần chạy được, còn acceptance hoặc phần việc bắt buộc.
  - *Chưa*: chưa có implementation.
  - *Hoãn*: exclusion đã được người yêu cầu ghi nhận có tên.
  - *Blocked*: cần quyết định hoặc tài nguyên bên ngoài.

## 1. Bảng tổng hợp

| Phase | Trạng thái | Việc còn lại chính |
|---|---|---|
| P00 | Một phần | Chưa có inventory 55 key + tabs/actions có phân loại real/shared/mock-only; chưa có dirty-file ledger. |
| P01 | Một phần | Chưa test abort và late-ACK của transport/port. |
| P02 | Một phần | Có code và gate live; A01 cần artifact runtime thật (dedicated run). |
| P03 | Một phần | Có code và gate; chưa kiểm retry attach sau lỗi trên browser. |
| P04 | Một phần | Có code; chưa kiểm tamper, traversal, mất quyền, interrupted download trên browser. |
| P05 | Một phần | Có code và gate; chưa có vòng đầy đủ draft → review → confirmed → remediation → retest → resolved với hai actor trên browser. |
| P06 | Một phần | Backend, API, panel có; chưa có live hai browser (A07). |
| P07 | Một phần | Ack tách biệt, idempotent: xong. PDF/DOCX: **Hoãn** (D05, exclusion có tên). |
| P08 | Xong (code) | Còn 3 mục registry (xem §3, P08). |
| P09 | Gần xong | Port và adapter đã có cho các domain chính; còn mục mock-only và chưa có parity checklist. |
| P10 | Một phần | Đã live: roster, message delivered/handled, cancel, retry, reassign, restart, parent stop. Có test deterministic hai dispatch cùng role. Còn: forward live, hai instance đồng thời live, pin câu hỏi trong messenger (UI), DTO instance vào web-contracts. |
| P11 | Một phần | Pause/resume/complete backend + live xong (13.24). Còn: UI controls (session UI), step controls (cần mapping step ↔ objective). |
| P12 | Một phần | Bước 1, C2 provider adapter, Operations, Fleet có; C2 grant verification xong (13.24). Còn: Results/Trace, C2 round-trip Sliver lab, campaigns (blocked theo ROE), lifecycle UI. |
| P13 | Chưa | Chờ P09–P12; chưa có build/digest/evidence tổng hợp. |

Ngoài phase: browser click-through của luồng chính chưa chạy (phiên không có browser tool); sandbox per-project cho project mới phải provision thủ công (xem §5).

## 2. Chi tiết theo phase

### P00 — Khóa inventory, contracts và acceptance baseline
- **Đã có:** ADR-0087/0088 Accepted; D01–D08 ghi nhận trong ledger §13.1.
- **Còn thiếu:**
  - Inventory 55 key và các project tabs/modals/header actions, phân loại real/shared/mock-only và owning port.
  - Phân loại gap theo UI / API / deployment / evidence.
  - Dirty-file ledger và image digest/revision cho lượt baseline.
- **Acceptance:** chưa có mapping feature/action → test selection cho PR đầu.

### P01 — Hoàn thiện feature ports và real transport
- **Đã có:** `EvidenceUploadInput` có bytes; transport binary kiểm độ dài và SHA-256 (ledger 13.15).
- **Còn thiếu:** test abort và late-ACK cho port/adapter.

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
- **Đã có:** migration `20261024`; comments, retests, activity, references; retest rule theo requester decision; gate pass; ADR-0088 Accepted.
- **Còn thiếu:**
  - Vòng đầy đủ hai actor trên browser, kèm một refusal.
  - `finding.auditTrail` và `finding.reportLink`: ledger 13.15 ghi backend có nhưng chưa nối UI. Registry hiện không còn entry cho hai mục này, nên cần kiểm lại trên browser trước khi coi là đã nối.

### P06 — Report composition, options và review readiness
- **Đã có:** template có version; kỳ báo cáo; reviewer được đặt tên; snapshot finding theo version; readiness tính ở server; lineage khi revise; gate `p06-report-composition-live.ts` pass.
- **Còn thiếu:**
  - Live hai browser sửa/duyệt (A07): approved content không drift khi finding đổi.
  - `report.projectInfo`: ledger 13.15 ghi backend có nhưng chưa nối UI; cần kiểm lại như P05.

### P07 — PDF/DOCX export, delivery và acknowledgement riêng
- **Đã có:** acknowledgement tách biệt khỏi delivery, idempotent theo request id; JSON/Markdown export giữ nguyên.
- **Hoãn:** PDF/DOCX theo quyết định người yêu cầu (D05). Đây là exclusion có tên; UI hiển thị `unavailable`, không giả PDF.
- **Ghi chú:** mục `report.pdfDocx` vẫn nằm trong registry gap, đúng với exclusion này.

### P08 — Khép shared Findings/Evidence/Reports tại mọi entrypoint
- **Đã có:** project tab và standalone dùng `ReportsPage`/`FindingList` chung; đã xóa `RealReportsPanel`, `RealReportEditor`, `RealReportSetup`, `RealFindingsPanel` và test tương ứng (commit `8a03dd0`).
- **Còn trong registry (3 mục):**
  - `evidence.original` và `evidence.integrity`: legacy evidence không có retained capture digest. Đây là giới hạn dữ liệu, không phải việc thiếu code.
  - `report.pdfDocx`: thuộc P07 (Hoãn).
- **Lưu ý:** ledger 13.15 ghi 8 mục; sau P08 còn 3. Cần ghi lại số này trong ledger khi cập nhật.

### P09 — Assets/Library và administrative UI dùng chung
- **Đã có (theo ledger 13.10, 13.17–13.19):**
  - Assets (`59b8694`), Library (`a222392`).
  - Scope & ROE, Team, Settings, Vault, Audit, Closure, Analysis, Planning, Governance, Notices: có port và panel/tab dùng chung. Inventory đã xóa.
  - Mock adapter ánh xạ dữ liệu mock khi mock có cùng model; khi mock không có model tương đương thì port chỉ có real.
- **Còn thiếu:**
  - Mục mock-only: inbox phê duyệt trong tab Team & Approvals của mock, plan review mock (`g-plan`), session console mock (`h-session`, `c-console`) mới chỉ đổi lời gọi sang port.
  - Parity checklist theo domain (exit §6 P09): chưa có bằng chứng "không còn unique action ở real panel cũ".
  - Ledger 13.19 ghi vitest toàn bộ 1285/1292; 7 lỗi theo thời gian (RealProjectCreateDialog, a11y/dark-theme/responsive audit, copilot drawer) chưa xử lý độ ổn định.

### P10 — Runtime instance identity, inbox/history và controls
- **Đã có (live trên lab 10.129.227.140, ledger 13.22–13.23):**
  - Roster đúng instance/attempt/role; history attempt được giữ.
  - Message: `accepted → delivered → handled (model_turn_completed)` trên attempt đang chạy.
  - Cancel cooperative: `cancel_requested` tách biệt với `cancelled` observed; ledger khớp mailbox.
  - Retry có grant và chạy đúng persisted intent (cùng dispatch, intent 1635 ký tự trùng); reassign sang role khác tạo dispatch mới.
  - Restart runtime lúc attempt chạy: attempt → `interrupted`, message → `undelivered/instance_interrupted`; durability mailbox giữ nguyên.
  - Parent stop: attempt con `interrupted`, message chờ `undelivered`, run cha `interrupted`.
  - Question của planning (soundwave): pending interrupt → resume bằng `questionId` → run success.
- **Đã có (code + test xác định):** ADR-0089 và ADR-0090; grant store; chặn redispatch sau cancel và sau interrupt (`cancelled_intent`, `interrupted_intent`); cô lập mailbox theo test; `test_instance_cases.py` (sibling isolation, cancel trong model call, cancel tại boundary kế tiếp, parent stop).
- **Còn thiếu (acceptance chưa đạt):**
  - **Forward live:** cần attempt đích đang chạy trên cùng thread. Run 1 của kịch bản forward bị treo do vòng `sleep` của model, nên run 2 bị 409. Attempt A đã nhận message `handled`. Chưa có forward live.
  - **Hai instance cùng role đồng thời:** model dispatch tuần tự dù được yêu cầu song song. Chưa có bằng chứng live. Cần prompt/tool buộc concurrency hoặc chấp nhận là blocked.
  - **Pin câu hỏi theo instance:** execution assistant không có tool `ask_user`; mới kiểm chứng ở planning (không có instance). Batch resume giữ nguyên.
  - **Deterministic:** chưa có test end-to-end cho hai instance cùng role qua dispatch thật (mới có ở mức mailbox/middleware).
  - Messenger chưa liệt kê câu hỏi pinned; hiện chỉ có nhãn ở root conversation.
  - Lineage reassign chỉ có trong run message, chưa có bảng riêng (ADR-0089 không yêu cầu bảng, ghi nhận như hạn chế).
  - DTO instance còn trong `api.ts` và `run-service.ts`, chưa chuyển vào `@raptix/web-contracts` như ADR-0089 yêu cầu.

### P11 — Operations lifecycle và step controls tại runtime
- **Đã có:** nền tảng gần nhất là `cancelRun` = LangGraph `cancel?action=interrupt`, giữ checkpoint có thể resume. Đây **không phải** pause có semantics đầy đủ (chưa có pause intent, chưa có `pause_requested`).
- **Quyết định đã chốt (requester, mục 4–7):** pause cooperative tại safe point, in-flight tool hoàn tất, chỉ báo paused khi có checkpoint resume được; resume tiếp tục checkpoint cùng attempt, không gửi lại prompt; complete là audited bookkeeping sau terminal và đối soát; storage dùng thread/run/binding hiện có, không thêm business-operation table.
- **Còn thiếu (toàn bộ phần implementation):**
  - Pause: safe point, pause intent durable, trạng thái `pause_requested` đến khi runtime xác nhận.
  - Resume: đọc authoritative paused checkpoint; recheck quyền, scope version, plan expiry, preflight, stop latch, closure, sandbox context; không tự resume sau restart.
  - Complete: audited, đảm bảo child attempts/tools đã reconcile, pending questions/approvals và uncertain outcomes đã disposition; không đổi failed thành success; không tự terminate C2.
  - Step review/approve/return/skip theo step identity/revision (chưa có step model trong runtime; OPPLAN objectives là ứng viên, cần quyết định mapping).
  - UI Operations: pause/resume/complete hiện chưa có (tab nói rõ điều này).
- **Acceptance cần:** safe-point và in-flight boundary; paused restart; stale token/version; double resume; question-vs-pause; terminal failure; child còn chạy; stop race; approval deadline. Live: request → ACK → pause, rồi resume checkpoint không duplicate side effect.

### P12 — C2 và Operations presentation migration
- **Đã có (ledger 13.19):**
  - Bước 1: `h-session` và `c-console` đi qua port; clock nằm trong mock adapter.
  - C2 provider: port, adapter, tab dùng chung (grants, listeners/profiles, console, session routes). Live: provider không cấu hình trên deployment này, banner hiển thị đúng trạng thái.
  - Operations: tab thread/run/timeline/cancel dùng chung (live 8/8).
  - Fleet: tab dùng port runtime (live 4/4). Latency `/fleet` khoảng 5 giây mỗi lần đọc; ghi nhận, chưa tối ưu theo quyết định.
  - Campaigns: giữ route thật có tên; listeners/profiles đã nằm trong C2 tab; generate/deploy giữ nguyên.
- **Còn thiếu:**
  - **Results và Trace:** chưa có real panel; chưa có adapter từ runtime history/events. Quyết định: phải hoàn thiện, không chuyển thành mock-only (§11 requester).
  - **C2 grant verification:** quyết định (mục 9) yêu cầu server xác minh session tồn tại trong đúng provider namespace khi request, và recheck khi approve/dispatch. Chưa implement; server hiện nhận session id chưa tồn tại (`sess-live-check` trong ledger 13.19).
  - **C2 round-trip live:** quyết định (mục 8) cho phép Sliver/bridge trong lab Docker cục bộ, không đưa lên 10.129.227.140. Chưa dựng. Đây là acceptance còn mở, không phải exclusion.
  - **Campaigns generate/deploy:** **Blocked.** Quyết định (mục 10): không có engagement nào được duyệt cho phishing hoặc social engineering; không chạy GoPhish/Evilginx để phishing. Giữ retained routes; acceptance live ghi blocked có tên.
  - Lifecycle controls của Operations (pause/resume/complete) chờ P11.
  - Mục "Cần kiểm chứng" của phase: provider success acceptance vẫn blocked.

### P13 — Final integration, cleanup và acceptance ledger
- **Chưa làm.** Chờ P09–P12 (theo required scope).
- **Còn thiếu:** reconcile inventory 55 key; build UI/API/runtime với source revision, tree digest và image ID; migration trên dedicated DB; chạy acceptance còn thiếu §9–§10; dọn deprecated panels/contracts/gates; cập nhật tracker và runbook.

## 3. Registry gap hiện tại (3 mục)

| Key | Lý do | Phase liên quan | Trạng thái |
|---|---|---|---|
| `evidence.original` | Legacy evidence không có retained capture | P04 | Giới hạn dữ liệu (không phải code thiếu) |
| `evidence.integrity` | Legacy evidence không có digest để verify | P04 | Giới hạn dữ liệu |
| `report.pdfDocx` | PDF/DOCX chưa render | P07 | **Hoãn** (D05, exclusion có tên) |

## 4. Việc phát sinh ngoài plan trong lượt này

- **Sandbox per-project cho project mới (ADR-0086):** project mới không có container `sbx-<slug>` cho đến khi chạy `raptix web sandboxes sync`. Khi thiếu, planner kẹt im lặng vì mỗi tool sandbox retry 150 giây (không có event trên UI). Đã sửa launcher (`b4bef5c1`): volume đúng và không xóa sandbox khi listing rỗng. **Còn mở:** preflight báo sandbox thiếu; project tự provision hoặc run fail nhanh với thông báo rõ.
- **Retry 150 giây mỗi tool call của sandbox:** quá dài, làm UI im lặng. **Còn mở:** fail nhanh và đưa lỗi thành event hiển thị được. Đây là quyết định thiết kế, chưa đổi.
- **HITL bash approval:** runtime bật `RAPTIX_HITL__REQUIRE_BASH_APPROVAL=1`, mỗi lệnh bash chờ operator (timeout 300 giây, mặc định deny). Trong test, duyệt bằng script chỉ cho lệnh cục bộ. **Còn mở:** duyệt trên UI cho luồng chính.
- **Browser click-through của luồng chính:** chưa chạy. Các API đằng sau từng bước đã kiểm chứng (ledger 13.23). **Còn mở:** cần browser để xác nhận UI.
- **Dev-server reload trên stack nghiệm thu:** đã tắt (`--no-reload`, `ca928fad`). Không còn trạng thái này trên stack live.

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

## 6. Thứ tự đề xuất để đóng phase

1. **Luồng chính trên UI:** browser click-through; preflight báo sandbox thiếu; duyệt bash trên UI.
2. **P10 còn lại:** forward live; cơ chế concurrency cho hai instance; pin câu hỏi trong messenger; chuyển DTO instance vào `@raptix/web-contracts`.
3. **P11:** quyết định mapping step ↔ OPPLAN objective; implement pause safe point, resume checkpoint, complete bookkeeping; live.
4. **P12:** Results/Trace adapter; C2 grant verification; C2 lab round-trip (Sliver trong Docker cục bộ); campaigns giữ blocked.
5. **P00–P06 acceptance còn mở:** browser cho P03/P04/P05/P06; A01 artifact; test abort/late-ACK P01.
6. **P09 parity:** checklist theo domain và xử lý mock-only.
7. **P13:** cuối cùng, sau khi các phase trên có bằng chứng.
