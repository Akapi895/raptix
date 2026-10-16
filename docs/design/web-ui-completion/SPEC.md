# Web UI Completion — Product Specification

**Status:** Draft for review; chưa publish tracker, chưa ready-for-agent.
**Ngày:** 2026-10-13. **Baseline khảo sát:** branch `tool`, HEAD `86fd86a` cùng các thay đổi runtime chưa commit.
**Nguồn yêu cầu:** hoàn thiện toàn bộ giao diện và mọi thao tác tương tác được mô tả trong cuộc hội thoại; chỉ lập kế hoạch.
**Phương pháp:** `to-spec` cho đặc tả, `to-tickets` cho vertical slices và blocking edges.

## Problem Statement

Operator đã dùng được nhiều phần của Web, nhưng chưa đi trọn mọi workflow mà không can thiệp file, env hoặc terminal. Planning đôi khi đọc được tài liệu qua sandbox nhưng validator không tìm thấy; UI và backend chưa đồng nhất điều kiện handoff; history tool có thể mất sau reload; trạng thái run thành công có thể đồng thời là thread đang chờ trả lời. Các cấu hình model/integration, workflow findings và report rendering còn thiếu. Campaign/C2 có implementation và lab evidence nhưng chưa chứng minh khả năng vận hành trên deployment hiện tại. Một trang đã mount hoặc health trả 200 chưa bảo đảm thao tác thực tế hoạt động.

## Solution

Hoàn thiện Web theo ba profile nghiệm thu có phạm vi rõ ràng:

1. **LOCAL-FULL:** toàn bộ 13 trang cho local single-user, gồm planning editor, execution/recovery, inventory/logs, Vault/integrations, findings/retest, reporting, notifications, Campaign và C2 trong phạm vi provider đã có. Thiết lập deployment ban đầu có thể cần operator; sau bootstrap, cấu hình ứng dụng và nghiệp vụ hằng ngày thực hiện qua Web.
2. **HITL-ON:** profile bổ sung cho LOCAL-FULL, nghiệm thu producer approval thật, allow/deny/resume và recovery. HITL mặc định hiện tại không bị đổi ngầm.
3. **TEAM-HOSTED:** track mở rộng có auth/membership/RBAC, cross-user isolation, crash durability và vận hành hosted. Được lập kế hoạch đầy đủ nhưng cần duyệt mở lại scope trước triển khai, vì quyết định trước đó giữ single-user.

Không dùng readiness của LOCAL-FULL để tuyên bố TEAM-HOSTED hoàn tất. Nếu mục tiêu cuối cùng được duyệt bao gồm cả team/hosted, chỉ đóng toàn bộ chương trình sau khi cả ba profile pass.

## User Stories

1. As a local operator, I want to create an engagement with an actionable brief, so that planning starts from persisted intent.
2. As a local operator, I want to reopen an engagement after reload, so that metadata and workflow state remain consistent.
3. As a local operator, I want planning and execution to use the same engagement workspace, so that generated documents are visible to every validator.
4. As a local operator, I want to answer one or several planning questions, so that the planner can continue without losing choices.
5. As a local operator, I want to review answers before submitting, so that an accidental selection does not resume a run.
6. As a local operator, I want to inspect and edit all eight planning documents, so that corrections do not require filesystem access.
7. As a local operator, I want to see document validation reasons, so that I can fix the actual blocker.
8. As a local operator, I want explicit handoff confirmation enforced by the server, so that execution follows the reviewed plan.
9. As a local operator, I want changes to the approved plan to require revalidation, so that old approval cannot authorize new scope.
10. As a local operator, I want OPPLAN creation and progress distinguished from the eight-document bundle, so that readiness is not misleading.
11. As a local operator, I want execution to run real tools, so that progress is operational rather than a demo.
12. As a local operator, I want grouped tool activity and readable Markdown, so that the console stays usable during long runs.
13. As a local operator, I want available thinking traces displayed consistently, so that models with and without that field both work.
14. As a local operator, I want multiline messages and keyboard navigation, so that complex briefings and question answers are easy to enter.
15. As a local operator, I want running, waiting, interrupted, failed and completed states distinguished, so that I know what action is needed.
16. As a local operator, I want retry and reconnect without duplicate dispatch, so that a lost acknowledgement does not rerun an operation.
17. As a local operator, I want persisted tool output and answered-question history, so that reload does not remove the record of work.
18. As a local operator, I want missing checkpoints reported explicitly, so that an empty screen is not mistaken for recovery.
19. As a local operator, I want backup and restore instructions exercised on real state, so that engagements survive lifecycle operations.
20. As a local operator, I want to select a model and fallback configuration in Settings, so that changes affect actual new runs.
21. As a local operator, I want language and supported budget settings applied to runtime work, so that preferences are effective.
22. As a local operator, I want integrations to reference Vault secrets, so that credentials do not travel in public configuration DTOs.
23. As a local operator, I want actual connection probes, so that configured and reachable providers are distinguishable.
24. As a local operator, I want store, reveal and revoke to have clear audit outcomes, so that secret management is reliable.
25. As a local operator, I want graph and asset views to show real scoped records, so that inventory agrees across pages.
26. As a local operator, I want logs to expose provenance, filters and export, so that operational events can be investigated.
27. As a local operator, I want to create and edit findings, so that analyst work is not limited to parsing runtime files.
28. As a local operator, I want to link retained evidence to a finding, so that a recorded claim has inspectable support.
29. As a local operator, I want evidence digests and producer lineage retained, so that integrity and attribution are not fabricated.
30. As a local operator, I want finding lifecycle changes to be persisted, so that verified and merely recorded claims remain distinct.
31. As a local operator, I want controlled retest jobs, so that verification is based on observed output.
32. As a local operator, I want report snapshots built from the actual engagement, so that later edits do not silently change a deliverable.
33. As a local operator, I want report templates and previews, so that exports match the selected layout.
34. As a local operator, I want PDF and DOCX downloads, so that reports can be delivered without external conversion.
35. As a local operator, I want AI report compilation tied to evidence references, so that generated prose cannot invent findings.
36. As a local operator, I want retained signed report artifacts, so that exported bytes can be verified later.
37. As a local operator, I want notifications for actionable events, so that a waiting run or failed job is visible outside the active page.
38. As a local operator, I want GoPhish preparation and deployment through the configured provider, so that campaign jobs have native outcomes.
39. As a local operator, I want evilginx2 preparation and reconciliation through its typed bridge, so that provider state is inspectable.
40. As a local operator, I want listeners, HTTP C2 profiles and owned sessions visible, so that C2 transport is distinct from agent threads.
41. As a local operator, I want explicit path-and-argv C2 commands with persisted outcomes, so that execution does not rely on a fake terminal.
42. As a local operator, I want uncertain campaign and C2 outcomes reconciled without redispatch, so that retries do not duplicate actions.
43. As a local operator, I want a truthful Members page and persisted operator preferences, so that local identity is not confused with RBAC.
44. As a local operator, I want archive/delete/retention consequences visible, so that project lifecycle does not orphan provider state silently.
45. As a keyboard or mobile user, I want all 13 pages accessible and responsive, so that every supported action is usable.
46. As a local operator, I want production builds to use real mode, so that demo fixtures cannot become operational state.
47. As a maintainer, I want feature-sensitive CI and actual release verification, so that green badges prove required checks ran.
48. As an operator using HITL, I want an approval request from the actual runtime, so that the decision controls the pending action.
49. As an operator using HITL, I want deny, allow and reload recovery handled distinctly, so that approval cannot be duplicated or bypassed.
50. As a team operator, I want a real authenticated session, so that identity is established by the backend.
51. As a team owner, I want persisted invitations and memberships, so that access is assigned to real people.
52. As a team owner, I want server-enforced permissions on reads and mutations, so that role labels match behavior.
53. As a team operator, I want cross-user and cross-engagement isolation for HTTP, streams and artifacts, so that private state is not disclosed.
54. As a hosted operator, I want accepted operations and checkpoints durable across crashes, so that recovery does not duplicate work.
55. As a hosted administrator, I want quotas, observability and recovery drills, so that deployments can be maintained reliably.
56. As a product owner, I want a release acceptance matrix for the chosen profiles, so that incomplete tracks remain visible.

## Implementation Decisions

### Existing architecture and ownership

- Browser remains React/Vite; independent Web API remains Fastify/Prisma. Shared DTOs remain contract-only. Browser communicates with runtime, providers and storage through scoped APIs, never runtime internals.
- Mission state belongs to orchestration/mission, WHAT-resolution to capabilities, execution to adapters/workers/backends and normalization to knowledge ingest. Keep KG canonical for engagement knowledge; finding edits must not create a competing canonical graph.
- Prefer the current request ledger, ownership checks, checkpoint support, transcript/event interfaces, provider bridges and export services. Prefactor only at an actually insufficient seam.
- New public API/subsystem boundaries need a Proposed ADR before implementation. Relevant prior decisions cover local durability, campaign preparation, typed C2 bridge, mission ownership, pinned workspace semantics and private child-state isolation. Proposed ADRs are not treated as accepted automatically.

### Planning and authorization lifecycle

- Eight required planning documents determine bundle readiness; OPPLAN is separately produced/maintained by the orchestrator. UI counts distinguish required readiness from optional/next-phase documents.
- Effective execution permission is authorization + verified metadata + valid current bundle + confirmation of that bundle revision + verified runtime/workspace binding. Enforcement covers thread creation, run submission, applicable resume and retest entrypoints.
- Confirmation uses a validated revision/content fingerprint, not only a timestamp. A changed bundle invalidates confirmation for new execution. Concurrent edit/confirm/submit must check one consistent revision; active runs use an explicitly recorded plan snapshot and do not silently receive an edited plan.
- Workspace has a trusted topology: pinned engagement mounts use runtime root once; shared development roots use a scoped slug once. Mirror/sandbox/API access must agree on the document identity. No copying to a second plan directory to make a validator pass.

### Durable interactions

- Request identity and intent are persisted before dispatch. Same-intent retries recover the same operation; changed intent conflicts. Unknown outcome becomes uncertain/reconcile, never implicit redispatch.
- Public effective status derives from run, thread/checkpoint, pending questions, approvals and recovery state. Provider/native statuses remain visible without conflating successful run termination with engagement completion.
- Durable event envelopes retain engagement/thread/run identity where observed, tool/question IDs, source, timestamp/sequence, bounded payload and explicit truncation. Thread-level events without producer run identity stay thread-level.
- Store answer values with their identity and accepted-resume relation, excluding unrelated secrets. Reload restores confirmed answer display; an accepted request is not fabricated as successful execution.
- Model traces are optional declared public fields. Do not expose private graph bookkeeping, internal channels or fabricate thinking for providers that do not supply it.

### Configuration and integrations

- Settings persists versioned application configuration; per-run snapshot identifies the effective model, supported fallback/language/budget and integration versions. Changes apply to new runs unless an explicit safe update policy exists.
- UI selects validated integration resources and Vault secret references, not arbitrary runtime config dictionaries or shell commands. Secret bytes do not appear in list/config/export DTOs. Backend probes actual authenticated connectivity with bounded timeout and records freshness.
- Distinguish supported, configured, reachable, eligible and operationally exercised. Capability available alone does not prove inference, delivery or native execution.

### Evidence, findings and reports

- Analyst changes are recorded claims with write attribution. Retained scanner capture, evidence reference, producer lineage, digest integrity and corroboration are separate concepts.
- Finding edits are versioned with optimistic conflict handling and interoperability with runtime-generated findings. Verification requires an observed verification record; clicking a status button does not prove exploitability.
- Report jobs produce immutable, versioned snapshots and retained artifacts. Templates, AI-assisted compilation, rendering, signing and download are separate observable outcomes. Signing proves bytes/signature validity, not truth of every claim.
- Rendering and AI jobs are bounded, resumable/inspectable and have explicit failure outcomes. Large file preview is capped; a full download uses the authorized artifact path rather than silently truncating the deliverable.

### Providers and supported scope

- Reuse GoPhish/evilginx2 implementations and Sliver typed bridge. Complete cutover, registry configuration, owned-resource discovery, reload/restart and reconciliation gates first.
- Preserve existing provider limits: isolated campaign lab scope, typed bridge operations without captured credentials/session tokens in DTOs, owned Sliver sessions, explicit command path + argv and HTTP C2 profile semantics.
- Interactive Shell/PTYS, implant generation from the browser, beacon tasking, unrestricted delivery/targets and Windows-specific C2 expansion are not silently included by the phrase full UI. Supporting them would require a separate scoped decision and tickets.

### Local, HITL and team modes

- Local single-user remains a supported mode; no fake members or role controls. TEAM-HOSTED is an explicit extension, not removal of local mode.
- HITL mode is explicitly configured and tested both on/off. Existing safety-critical slots and tool authorization are preserved.
- TEAM-HOSTED requires an accepted identity/session strategy, enforcement on all transports, persistent memberships and a crash-durable runtime/control-plane design. SQLite graceful-recreate evidence cannot close that profile.

## Testing Decisions

- **Primary seam for user behavior:** actual browser → Web API → real DB/runtime/provider/storage. Reuse deployed smoke/core-flow/provider/recovery harnesses; no page interception in live acceptance.
- **Supporting seams:** scoped HTTP API and public runtime/provider protocol boundaries for deterministic faults, concurrency, invalid input and lost-ACK checks. Mock external environment only, not the code under test.
- **Unit/contract tests:** reducers, validators and projections when highest-seam tests cannot cover the specific branch efficiently. They do not replace live provider evidence.
- Every feature needs a success path, a meaningful failure path and persistence/reload verification. Dispatching mutations additionally need concurrency, replay and uncertain-outcome checks.
- Bug tests must demonstrably fail on the unfixed baseline. CI canaries must fail when a deliberate regression is introduced and pass after restore.
- Full procedures, expected results, commands and required evidence are in TEST-PLAN. All listed live procedures are planned acceptance, not tests claimed to have run in this planning session.
- **Review request:** confirm that the browser full-stack seam plus API fault/concurrency seam is the desired acceptance boundary before tickets are promoted.

## Out of Scope

- This delivery does not implement runtime/UI code, migrate databases, change deployment, run an assessment, publish tracker issues, commit or push.
- Infrastructure provisioning and initial operator secret bootstrap are not browser-only business workflows. Web completion must not expose a general Docker/host shell merely to eliminate terminal use.
- Features beyond declared provider scope, unrelated runtime optimization and wholesale architecture replacement are excluded. Hosted/team work is specified but activation awaits scope approval.

## Further Notes

- Historical documents mix old paths, outdated statuses and older gate counts. Current code/manifests/CI prevail; baseline failures and historical pass counts must be re-measured on an exact revision.
- The last session reported UI 91 tests and API 280 tests passing, and an earlier real-fixture lane had 27 failures. Those are historical observations, not current whole-product acceptance.
- Current planning documents are stored as draft repo artifacts. No configured tracker/triage vocabulary was found; run `/setup-matt-pocock-skills` before publishing. After seam/granularity/dependency review, publish one ticket per issue with `ready-for-agent` and native blocking edges where supported.
