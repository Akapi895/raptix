# Implementation Plan — Hoàn thiện Web UI end-to-end

**Status:** Draft cần duyệt. **Ngày:** 2026-10-13. **Scope:** plan-only.

## 1. Bộ tài liệu và cách sử dụng

- [SPEC](SPEC.md): product scope, user stories, behavioral contracts và architectural decisions.
- [TEST-PLAN](TEST-PLAN.md): test seams, commands, live procedures, expected results và evidence.
- [Tickets](tickets/): 52 draft tickets; mỗi ticket có deliverable, blockers, steps, acceptance, test và completion evidence.

Đây là draft breakdown theo `to-tickets`, chưa phải tracker đã cấu hình. Sau khi duyệt seams, granularity và blockers, mới publish; không tự tạo 52 issues hoặc apply labels khi chưa duyệt.

## 2. Mốc nghiệm thu

| Mốc | Nội dung | Exit gate |
|---|---|---|
| M1 — Reliable core | Planning/handoff, execution, status, durable history, reasoning, recovery | T11; fresh project đi hết core flow trên deployment thật |
| M2 — Full local product | Tất cả 13 trang, Settings/integrations, findings/retest, report jobs, notifications, providers | T40; toàn bộ supported local interactions pass |
| M3 — HITL-ON | Producer approval thật, allow/deny, interruption/recreate | T44; cả HITL-off và HITL-on pass |
| M4 — Local distribution | Production bootstrap, CI, install/update/rollback và scope docs | T42 + T51; fresh install và update giữ state đúng |
| M5 — Team/hosted extension | Authentication, membership/RBAC, transport isolation, crash durability | T50 + T52; chỉ bắt đầu implementation khi duyệt mở scope |

LOCAL-FULL hoàn tất ở M2 + M4. Nếu tuyên bố hỗ trợ HITL bật thì cần M3. Nếu mục tiêu cuối cùng gồm toàn bộ team/hosted đã đề cập thì phải đạt thêm M5; không dùng single-user acceptance thay thế.

## 3. Baseline và loại công việc

| Thành phần | Đã có | Gap đã quan sát / cần xác minh | Loại việc |
|---|---|---|---|
| Projects / brief | Persist brief, tạo từ UI, land Console | Re-measure fixtures; versioned briefing/lifecycle polish | Complete + verify |
| Planning | Read/validate tám docs, interview/resume | Workspace/validator mismatch; edit/revision absent | Fix + extend |
| Handoff | UI panel + persisted timestamp | Server executionReady chưa kiểm tra confirmation; confirmation PATCH chưa validate bundle | Fix policy consistency |
| Console | Grouped tools, Markdown, CONFIRM, sticky scroll | Durable full tool/answer history, effective status, fault recovery, multiline UX | Complete + verify |
| Reasoning | Web DTO/rendering; Python working-tree changes | Commit/check/rebuild; unsupported model behavior | Integrate + deploy |
| Vault | Store/reveal/revoke | Integration secret references, expiry/revocation UX, restart/probe | Extend + verify |
| Graph / assets | Real reads and scoped projection | End-to-end ingest/update consistency, full supported interactions | Verify + polish |
| Findings | Read parsed runtime files + preview | Analyst edits/workflow/evidence/retest | New vertical slices |
| Reports | JSON/Markdown downloads | Snapshots/templates/jobs/PDF/DOCX/AI/signing | New vertical slices |
| Settings | Metadata fields | Model/runtime config, integration registry/probes, notifications/templates | New vertical slices |
| Campaigns | Native GoPhish/evilginx prepare/deploy/reconcile | Deployment cutover/config/current live evidence | Integrate + verify |
| C2 | Sliver native lab implementation | Current API reports provider_unavailable; normal deploy/live acceptance | Integrate + verify |
| Members | Truthful local operator | TEAM auth/invite/RBAC absent | Local complete; team extension |
| Durability | SQLite graceful recreate | Tool transcript retention; crash-safe hosted operations | Local verify; hosted architecture |
| CI/release | Existing scripts/workflows and historical evidence | Exact current revision acceptance/install/update/promotion | Re-verify + repair |

Historical pass evidence is reusable prior art, not a substitute for rerun. Không viết lại provider/code đã có nếu current implementation đáp ứng contract.

## 4. Ma trận bao phủ 13 trang

| Trang | Interactions bắt buộc LOCAL-FULL | Tickets | Live acceptance |
|---|---|---|---|
| Charter & ROE | Read/edit/version/revalidate, confirm handoff, lỗi validation/conflict rõ | 02,03,12,13 | L01,L02,L07 |
| Scope & Boundary | Read current scope, edit exclusions/constraints qua canonical plan, reapproval | 12,13,14 | L07; target/scope changes invalidate confirmation |
| Operator Console | Brief, planning/execution thread, send/multiline, questions/CONFIRM, cancel/reconnect/history, approvals khi bật | 04–11,14,43,44 | L01–L06,L18 |
| Vector Campaigns | Draft/select assets/prepare/deploy/reconcile/history | 16,17,32,33 | L15 |
| C2 & Sessions | Owned listeners/sessions/HTTP profiles, path+argv commands/history/reconcile | 16,17,34,35 | L16 |
| Infrastructure & Data | Scoped graph/detail/search/filter/refresh, provenance | 20 | L09 |
| Assets & Inventory | Derived inventory, dedupe/detail/filter/refresh, real ingestion updates | 20 | L09 |
| Credentials Vault | Store/list/reveal/revoke, integration refs and audit | 16,19 | L08 |
| Findings & Evidence | Create/edit/detail/evidence upload/link, status, verification/retest | 22–25 | L11,L12 |
| Operations Log | Provenance, filters/pagination/live refresh, export | 06,21 | L10 |
| Reports | Snapshot/template/preview, JSON/Markdown/PDF/DOCX, compilation/signing/download | 26–30 | L13 |
| Members | Local operator identity/preferences; team invites/RBAC only TEAM profile | 36,45–47 | L17,L19 |
| Settings | Metadata, model/fallback/language/budget, integrations/probes, notification/template links, archive/delete | 14–19,27,31,37 | L08,L14,L17 |

Không thêm sidebar entry thứ 14. Các panel/editor/job views nằm trong trang hiện hữu hoặc detail route tương ứng. Mock mode phục vụ visual regression riêng; không thể dùng mock để đóng một interaction real-mode.

## 5. Ưu tiên và dependency policy

- **P0:** blocker tính đúng đắn/khôi phục/authorization của core; làm trước khi mở rộng workflow.
- **P1:** bắt buộc để LOCAL-FULL, HITL-ON hoặc distribution hoàn tất; track TEAM ưu tiên bên trong profile riêng.
- **P2:** enrichment và track team/hosted đã lập kế hoạch. P2 không đồng nghĩa optional nếu profile cuối cùng bao gồm nó.
- Blocker chỉ là dependency thực sự: prerequisite contract/state/resource mà ticket tiêu thụ. Không dùng T01 như một blocker toàn cục cho mọi việc độc lập.
- Tickets cùng frontier có thể triển khai song song trong các phiên sau; phiên lập kế hoạch này không spawn implementation agents.
- Một ticket là behavior slice, không phải quota một commit. Mỗi PR phải ≤400 runtime lines, ≤10 files, một concern. Nếu slice vượt budget, chia child slices giữ old behavior green bằng expand → migrate → contract; update graph trước khi triển khai.

## 6. Breakdown theo thứ tự dependency

Mọi hàng dưới đây là **Draft**. Cột “Giao được” là kết quả demoable, không chỉ “đã tạo API”.

| # | Ticket | Pri/profile | Blocked by | Giao được |
|---|---|---|---|---|
| 01 | Baseline contracts và regression lane | P0/local | None | Exact-revision UI/API contract lane và failure inventory đáng tin |
| 02 | Canonical workspace cho planning và tools | P0/local | None | Agent ghi tài liệu, validator/API đọc đúng cùng file |
| 03 | Backend-enforced versioned handoff | P0/local | 02 | Chỉ bundle đã validate và confirm đúng revision mới cho execution |
| 04 | Planning Q&A và effective waiting status | P0/local | 02 | Multi-question CONFIRM/resume, waiting state rõ và không mất selection |
| 05 | Run reconnect, lost ACK và idempotent recovery | P0/local | 04 | Retry/reload không tạo duplicate thread/run/resume |
| 06 | Durable tool activity replay | P0/local | 05 | Reload giữ tool groups/output/provenance/pagination |
| 07 | Durable question-answer history | P0/local | 04,06 | Reload giữ answers/CONFIRM outcome mà không hỏi lại sai |
| 08 | Production reasoning transport | P0/local | None | Clean image giữ optional thinking và model không-thinking vẫn hoạt động |
| 09 | Console interaction completion | P1/local | 04,06,08 | Markdown/multiline/keyboard/scroll/cancel/error UX đầy đủ |
| 10 | Local backup, restore và recreate recovery | P0/local | 05,06,07 | Pending/terminal state và artifacts survive supported lifecycle |
| 11 | Fresh deployed core acceptance | P0/local | 01,03,07,09,10 | Project → planning → execution → runtime finding → report qua Web |
| 12 | Versioned planning document editor | P1/local | 02 | Web edit/save/conflict/reload cho tám docs |
| 13 | Revalidation và approval invalidation | P1/local | 03,12 | Edited plan revalidates; stale approval không mở execution |
| 14 | Brief revision và project workflow lifecycle | P1/local | 03,13 | Brief/readiness/OPPLAN/phase transitions nhất quán sau reload |
| 15 | Model và fallback settings applied to runs | P1/local | None | Settings model được snapshot và used by actual inference |
| 16 | Integration registry với Vault references | P1/local | None | Save integration không lộ secret, resource references scoped |
| 17 | Authenticated provider connection probes | P1/local | 16 | Configure/reachable/exercised states được phân biệt bằng probe thật |
| 18 | Language, budget và runtime settings | P1/local | 15 | Supported config persist và affects new runtime work |
| 19 | Vault dependency/revoke/audit UX | P1/local | 16 | Referenced/revoked secrets có outcome rõ và persistence thật |
| 20 | Graph và asset inventory live consistency | P1/local | None | Runtime ingestion xuất hiện trong cả graph và asset views |
| 21 | Operations Log pagination/export/provenance | P1/local | 06 | Search/filter/export/reload logs chính xác và scoped |
| 22 | Analyst finding create/edit/revision | P1/local | None | Runtime + analyst findings cùng đọc/edit được, conflict visible |
| 23 | Evidence upload/link/retained integrity | P1/local | 22 | Finding tham chiếu bytes retained với digest và lineage |
| 24 | Finding workflow và verification records | P1/local | 22,23 | Status/local responsibility/verification persist không giả evidence |
| 25 | Controlled retest job through Web | P1/local | 03,05,24 | Runtime retest có audit/output; timeout không thành verified |
| 26 | Immutable report snapshot jobs | P1/local | 22,23 | JSON/Markdown versioned từ một consistent evidence snapshot |
| 27 | Report templates và matching preview | P1/local | 26 | Selected template persist và preview khớp artifact inputs |
| 28 | PDF/DOCX rendering và downloads | P1/local | 27 | Job produce parseable retained files, failure/retry visible |
| 29 | Evidence-grounded AI compilation | P2/local | 15,26,27 | AI draft cites source; review precedes final artifact |
| 30 | Report signing và integrity verification | P2/local | 28 | Signed retained bytes verify; modified bytes fail |
| 31 | Notification preferences và real delivery | P1/local | 16,17 | Waiting/failure/job notifications persist và deliver đúng event |
| 32 | GoPhish normal-deployment cutover | P1/local | 17 | Browser prepare/deploy/reconcile matches native lab outcome |
| 33 | Evilginx2 typed-bridge cutover | P1/local | 17 | Browser native prepared/enabled states và restart reconciliation |
| 34 | Sliver listeners/profiles/sessions cutover | P1/local | 17 | Provider available, sessions owned và profiles persist |
| 35 | C2 command outcomes/replay/reconciliation | P1/local | 05,34 | Explicit command history survives timeout/restart without duplicate |
| 36 | Local Members và operator preferences | P1/local | None | Identity/preferences thật, không fake invitations/RBAC |
| 37 | Archive/delete/retention/provider cleanup | P1/local | 14,32,33,35 | Project lifecycle protects active work và handles owned resources |
| 38 | All-page accessibility/responsive acceptance | P1/local | 09,13,14,18,19,20,21,24,25,28,29,30,31,32,33,35,36,37 | Mọi supported action dùng keyboard/mobile và error/empty states đúng |
| 39 | Reproducible production bootstrap | P1/local | 11,18,19,32,33,35 | Clean real-mode image/migrations/config/providers, không docker-cp reliance |
| 40 | Complete 13-page LOCAL-FULL acceptance | P1/local | 11,13,14,18,19,20,21,24,25,28,29,30,31,32,33,35,36,37,38,39 | All local workflows pass live/reload/failure matrix |
| 41 | Feature-sensitive CI và negative canary | P1/distribution | 01 | Required jobs thật sự chạy và fail on deliberate regression |
| 42 | Release/install/update/rollback gate | P1/distribution | 39,40,41 | Published artifacts install/update; compatible rollback/state preservation |
| 43 | HITL mode configuration/readiness | P1/HITL | 18 | Effective on/off policy visible and persisted for runs |
| 44 | Native HITL allow/deny/recovery | P1/HITL | 11,43 | Runtime producer waits; actual decision controls execution once |
| 45 | Team authentication/session slice | P2/team | None | Real login/logout/session expiry via accepted identity architecture |
| 46 | Membership/invite/server RBAC | P2/team | 45 | Actual members/roles persist và permissions enforce |
| 47 | HTTP/stream/artifact cross-user isolation | P2/team | 06,46 | Every transport rejects foreign access and revocation closes streams |
| 48 | Hosted crash-durable runtime/control plane | P2/team | 10,45 | Kill/restart restores accepted work without redispatch/data fabrication |
| 49 | Hosted quotas/observability/recovery drills | P2/team | 31,46,48 | Operational limits, audit and restore drills work across identities |
| 50 | TEAM-HOSTED full-stack acceptance | P2/team | 40,44,46,47,48,49 | Two real users, policies, provider work and crash gates pass |
| 51 | Local/HITL release readiness ledger | P1/distribution | 42 | Versioned evidence and known limitations match shipped profiles; HITL-ON requires T44 before claiming support |
| 52 | Team release/readiness ledger | P2/team | 50,51 | Hosted claims only after exact-release team acceptance |

## 7. Thứ tự triển khai thực tế

### Wave A — Repair core

Start frontier: T01, T02, T08. Prioritize T03/T04 after workspace proof; then T05/T06/T07/T09/T10. Exit T11 trước khi tuyên bố workflow mới thay thế cách can thiệp thủ công.

### Wave B — Planning và configuration

T12 → T13 → T14; independently T15 → T18 và T16 → T17/T19. Model/integration settings mới cần persist + apply path end-to-end, không chỉ form-save.

### Wave C — Data và outcomes

T20 và T22 có thể start từ frontier độc lập. T21 follows durable events. T22 → T23 → T24 → T25; T26 → T27 → T28 và T29, sau đó T30. Notifications T31 độc lập với report rendering.

### Wave D — Providers và operational lifecycle

T32/T33/T34 dùng registry/probes; T35 dùng C2 registry và replay semantics. T36 độc lập; T37 sau provider ownership/lifecycle APIs. Reuse native implementations, cutover và verify thay vì rebuild feature from scratch.

### Wave E — Full local product và distribution

T38 kiểm tra cross-page interaction; T39 build sạch; T40 nghiệm thu tất cả local workflows. T41 có thể xây sớm khi baseline ổn; T42 chạy release thật sau local acceptance. T43/T44 xác minh HITL-on theo profile riêng. T51 đóng local ledger sau T42; nếu chưa pass T44 thì ledger chỉ được ghi HITL-ON chưa nghiệm thu, không tuyên bố hỗ trợ hoàn tất.

### Wave F — Team/hosted (scope activation required)

Architecture/auth slice T45 có thể được nghiên cứu sớm; implementation chờ duyệt scope. T46/T47 và T48 → T49, cuối cùng T50/T52. Không deploy multi-replica trên local SQLite bằng cách đổi số replica rồi tuyên bố hosted-ready.

## 8. Decision register trước implementation

| ID | Quyết định cần chốt | Ticket sở hữu | Recommendation draft / exit |
|---|---|---|---|
| D01 | Workspace topology và sandbox mirror semantics | 02 | Reuse trusted pinned/shared modes; marker + document identity proof |
| D02 | Versioned confirmation và active-run plan snapshot | 03,13 | Fingerprint current validated bundle; refuse stale confirmation |
| D03 | Public event retention/schema/ordering | 06 | Reuse existing record/stream seam; bounded paginated durable replay |
| D04 | Finding revision/write ownership giữa files/KG/DB | 22,23 | KG stays canonical knowledge; explicit claim metadata + retained bytes |
| D05 | Model/integration config precedence | 15,16,18 | Versioned server settings and per-run snapshot; preserve trusted runtime invariants |
| D06 | Render/AI/signing job persistence | 26–30 | Durable job/artifact interfaces; isolate rendering and secret key access |
| D07 | Notifications provider | 31 | In-app delivery mandatory; start SMTP mail-sink live gate, production connector explicit |
| D08 | Local lifecycle cleanup semantics | 37 | No unannounced volume deletion; uncertain cleanup blocks final completion |
| D09 | Hosted identity and permissions | 45,46 | Select supported auth/session strategy and permission matrix before schemas |
| D10 | Crash-durable hosted backend and consistency | 48 | Accepted ADR with explicit RPO/RTO, metadata/checkpoint reconciliation |
| D11 | Full product scope | Review | LOCAL-FULL + HITL-on planned; team track explicit activation; provider limits preserved |

Decisions D02–D10 introducing public APIs/subsystems require Proposed ADRs before code. Plan does not silently make those ADRs Accepted or select unresearched dependencies.

### Rủi ro và migration strategy

| Rủi ro | Cách xử lý trong kế hoạch | Owner |
|---|---|---|
| Shared-root/pinned mount đọc nhầm plan hoặc bỏ isolation | Verify actual trusted mounts/markers; normalize một lần; không copy file để che lỗi | 02 |
| Timestamp cũ được hiểu là đã duyệt current bundle | Expand confirmation identity; legacy data giữ nguyên nhưng không auto-arm; revalidate/reconfirm qua UI | 03,13 |
| Thêm event store làm trùng recorder và mất source identity | Reuse owning durable seam; retain observed provenance; cursor/dedupe migration với old reader compatibility | 06,07 |
| Analyst write làm mất runtime claim hoặc tạo second KG | Versioned canonical contract/attribution; concurrent conflicts; import compatibility gate | 22,23 |
| New settings bị save nhưng runtime vẫn dùng env khác | Effective config precedence + snapshot; actual inference/probe gate; active run snapshot không bị edit | 15–18 |
| Worker/provider timeout được retry thành duplicate operation | Persist intent trước dispatch; uncertain lock + native inspection; no implicit redispatch | 05,25,26,32–35 |
| Renderer/AI output không usable hoặc invent evidence | Parse actual files, source manifest/citations + review, explicit failed job; no ready toast alone | 26–30 |
| Provider gate pass trong lab nhưng deployment chưa cutover | Exact image/config/native resource proof trên candidate deployment | 32–35,39,40 |
| Auth migration làm local identity thành admin ngoài ý muốn | Explicit identity conversion/membership policy, local profile retained, two-user denied-action gate | 45,46 |
| SQLite recreate được quảng bá thành hosted crash-safe | Hosted ADR/backend/generation metadata and kill-point RPO/RTO gates | 48–50 |
| Release rollback không compatible DB/schema | Backup/version manifest; refuse unsupported downgrade; restore theo validated compatibility | 42 |

Migrations dùng expand–contract: thêm versioned fields/interfaces bên cạnh legacy, migrate callers trong các slice green, chỉ remove old shape sau caller/evidence audit. Không tự sửa hoặc purge operator data để làm live gate pass. Với ticket cần chọn dependency/auth/backend mới, ADR-selection là bước đầu tiên và delivery bị block cho đến khi quyết định được duyệt.

## 9. Definition of Done chung

1. Behavior works through actual UI/API and owning persistence/runtime/provider.
2. Invalid input, denied scope, unavailable dependency and uncertain operation have truthful visible outcomes.
3. Reload/reconnect/process lifecycle appropriate to the ticket preserves IDs, records and outcomes.
4. Mutations needing replay have same-intent recovery and changed-intent conflict tests.
5. Exact revision deterministic checks pass; changed bug tests observed fail before fix.
6. Relevant live acceptance from TEST-PLAN pass with no API intercept; provider-less runs cannot close provider tickets.
7. Evidence records revision/image/migrations/config-without-secrets, procedure, actual IDs, observed result, exit code and artifacts.
8. Any new API/boundary decision has the required ADR; diff budget respected or ticket split before PR.
9. Fixture/demo/prototype code cannot silently provide production real-mode state.
10. Ticket is not completed merely because code was committed. Deployment and stated evidence must match.

## 10. Review checkpoints

- Confirm profile scope: local full/HITL and whether to activate team/hosted.
- Confirm primary test seam: actual browser stack; supporting seam: scoped HTTP faults/concurrency.
- Review 52-ticket granularity and true blockers; merge only related slices or split slices exceeding PR budget.
- Configure tracker via `/setup-matt-pocock-skills`, then publish approved spec and one ticket per issue, marking `ready-for-agent` and preserving native dependency links.
- No code, data migration or deployment is authorized by this draft alone.
