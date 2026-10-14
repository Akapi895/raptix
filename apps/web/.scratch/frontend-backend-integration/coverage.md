# Coverage: new frontend to existing backend

Status: source inventory, 2026-10-14. No implementation or live-backend
verification is claimed. References are repo-root-relative unless stated.

Precommit audit: [verification-01-06.md](verification-01-06.md) records the
current verdict for tickets 01-06. All six are reopened; their implementation
and historical green tests do not yet satisfy the acceptance gate.

Latest follow-up: [regression-fixes-and-live-flow.md](regression-fixes-and-live-flow.md)
records passing regression fixes and actual planning/execution/output evidence.
It does not waive the remaining schema/deployment/HITL/cancel requirements.

Read [spec.md](spec.md) for requirements and unresolved decisions;
[execution.md](execution.md) for verification. Section 7 maps the approved 18
tickets to these surfaces; the earlier ownership columns identify the subsystem
that supplies the behavior, not a separate ticket for each row.

## 1. Classification

- **Existing:** route/service/contract is present in source; its deployment and
  compatibility still need verification.
- **Partial:** existing APIs cover part of the user flow or use different domain
  semantics. Adaptation and/or a backend extension is required.
- **Gap:** no matching public contract was found in the inspected route registry.
  This is not a claim that the entire Python runtime lacks related behavior.
- **UI/demo:** no real backend is needed for the presentation itself; demo data
  and simulated actions stay in explicit mock mode.

For every feature, track reads, writes and realtime separately. The presence of
one read endpoint is never evidence that its mutations or invariants exist.

## 2. Existing API inventory

Prefix **E** below means `/api/engagements/:id`. Registration is conditional on
services configured in `apps/web/server/src/main.ts` and `src/app.ts`.
Source filenames in this API table refer to the server's route/service modules;
they are not new files proposed for creation.

| API family | Existing routes | Source/authority | Limits for the new UI |
|---|---|---|---|
| Bootstrap | `GET /api/health`, `GET /api/health/ready`, `GET /api/capabilities` | `http/routes/{health,capabilities}.routes.ts` | Availability is not authorization or mock fallback |
| Engagements | `GET/POST /api/engagements`; `GET/PATCH E` | `projects.routes.ts`, `projects-service.ts`, Prisma Engagement | Demo wizard metadata/statuses exceed the current DTO |
| Planning | `GET E/plan-docs`, `GET E/opplan` | `projects-service.ts`, owned workspace documents | Readiness/OPPLAN is not business plan approval |
| Runtime selection | `GET /api/agents`, `GET E/runtime-context` | `runtime-context.ts`, runtime graph catalog | Graph IDs are not fleet endpoints/heartbeats |
| Ownership/recovery | `GET E/requests/:requestId`, `GET E/thread-bindings/:threadId`, `POST E/requests/:requestId/reconcile` | `runtime-ownership.ts`, WebRequestLedger/EngagementThread | Preserve stable IDs, accepted/uncertain/rejected distinctions |
| Threads/runs | `POST E/threads`, `GET E/threads`, `GET E/threads/:thread`; `GET/POST E/threads/:thread/runs`, `GET E/threads/:thread/runs/:run` | `runs.routes.ts`, `runtime/run-service.ts`, runtime API | Not the full demo operation lifecycle |
| Interrupt/cancel | `POST E/threads/:thread/resume`, `POST E/threads/:thread/runs/:run/cancel` | Runtime + ownership ledger | Resume answers graph interrupts; cancel is not global estop |
| Events | `GET E/threads/:thread/runs/:run/events` | `events.routes.ts`, `runtime/stream-service.ts`, shared streaming | Cursor/control frames, scope and recovery must be preserved |
| Tool HITL | `GET/POST E/approvals` | `approvals.routes.ts`, workspace requests/decisions JSONL | Allow/deny tool requests only; not ROE/closure/report/grant approval |
| Findings | `GET E/findings` | `findings-service.ts`, parsed workspace FIND files | No matching create/update/status-transition API in registry |
| Artifacts | `GET E/artifacts`, `GET E/artifacts/content` | `artifacts-service.ts`, owned workspace | Content reads are not upload, integrity attestation or lineage CRUD |
| Graph/assets | `GET E/graph`, `GET E/assets` | `graph-service.ts`, scoped Neo4j projection | No asset-import/scope-classification mutation contract |
| Timeline/export | `GET E/timeline`, `GET E/export` | `timeline-service.ts`, `export-service.ts` | Export is JSON/Markdown, not report drafting/review/delivery |
| Settings/delete | `GET E/settings`, `DELETE E` | `settings-service.ts` | Not the new six-tab organization/policy/retention write surface |
| Campaigns | `GET E/campaigns/capabilities`; `GET/POST E/campaigns`; `GET E/campaigns/:campaignId`; generate/deploy/job-reconcile POSTs | `campaign.routes.ts`, provider adapters + Prisma Campaign/Job | New frontend has no direct campaign route |
| C2 | `GET E/c2/sessions`; session commands POST; listener/profile POST; listener DELETE; command list/reconcile | `campaign.routes.ts`, `c2-service.ts`, Sliver adapter + C2Command ledger | No equivalent timed-grant approval/expiry workflow established |
| Vault | List/create/reveal/delete under `E/vault/secrets` | `vault.routes.ts`, `vault-service.ts`, encrypted Prisma records | Retain API; no direct new frontend route |
| Members | `GET/POST E/members`, `DELETE E/members/:memberId` | `members-service.ts` | Local-only list; invite/remove explicitly unsupported |

The route names above are observed contracts. Future extension URLs must be
specified and reviewed; this document does not invent endpoint availability.

## 3. All 53 new route keys

Source: `apps/web-improve/src/router/registry.tsx:MANIFEST`. Counts:
**a=9, b=3, c=5, d=10, e=6, f=6, g=8, h=4, s=2; total=53**.
IDs, panels and important actions below each route remain part of its coverage.

| Group | Route keys | Classification and integration gap | Owning subsystem |
|---|---|---|---|
| a | `login` | Partial: demo quick-pick vs trusted local identity/real auth; resolve D1 | Browser identity + server auth |
| a | `forbidden`, `notfound`, `error`, `offline`, `session-expired` | UI: render actual transport/auth/router outcomes, preserve recovery | Browser transport/router |
| a | `states` | UI/demo: explicit showcase, no operational backend writes | Browser demo |
| a | `command-center` | Partial: aggregate engagement/run/findings data; readiness/KPIs require truthful definitions | Browser read model + server aggregates |
| a | `tasks` | Partial: tool HITL exists; assigned findings/business-approval inbox needs contracts | Server workflow projections |
| b | `projects`, `project-new`, `project` | Partial: engagement CRUD/planning exists; full wizard, team, scope revisions/closure and detail tabs have gaps | Server projects/governance + browser forms |
| c | `operations`, `operation-new`, `operation` | Partial: owned run/thread APIs exist; operation binding, wizard, results and lifecycle mapping need D2 | Server runtime services + Python orchestration |
| c | `preflight`, `operation-schedule` | Gap: no matching public eight-check preflight/scheduling resource contract | Server business operation model + runtime gates |
| d | `agents`, `agent` | Partial: graph catalog exists; fleet health/allocation/group writes are different concepts | Runtime/worker/provider projections |
| d | `assets`, `asset` | Partial: graph asset list exists; detail enrichment must preserve observed provenance | Server graph projection |
| d | `asset-new`, `asset-scope` | Gap: import/classification, pending scope and approval/invalidation writes | Server scope/assets governance |
| d | `playbooks`, `playbook`, `technique`, `playbook-review` | Gap: corpus/runtime definitions are not a Web revision/review API | Server library facade + owning corpus/runtime |
| e | `analysis` | Partial: graph data exists; coverage/heatmap/observed-path views need defined projections | Server graph + browser analysis |
| e | `findings`, `finding` | Partial: workspace finding reads exist; new detail/lifecycle fields lack equivalent writes | Server findings + retained sources |
| e | `finding-new` | Gap: authoring/AI-import/status changes and persistent review lifecycle | Server finding workflow |
| e | `evidence`, `evidence-inspector` | Partial: artifact reads exist; upload, masking, hashes and producer references need contracts | Server artifacts/evidence |
| f | `reports`, `report-new`, `report`, `report-preview`, `report-review` | Gap for report lifecycle; existing export can support a distinct export action | Server report workflow + workspace export |
| f | `settings` | Partial: engagement settings read exists; organization/integrations/policy/retention/audit tabs need separate scopes and writes | Server settings + identity/audit |
| g | `ai-operator`, `ai-history` | Partial: thread messages/history/stream/interrupts exist; modes/pinning/search/copilot context need adaptation | Server runtime + browser conversation |
| g | `ai-plan`, `ai-plan-review`, `ai-plan-compare` | Partial: OPPLAN/planning-doc reads exist; proposals/revisions/four-eyes/24h deadlines are gaps | Server plan workflow + Python mission state |
| g | `ai-trace` | Partial: scoped stream events exist; policy/approval/execution facets and lineage must map to actual events | Shared contracts/streaming + runtime projection |
| g | `ai-fanout`, `ai-branch` | Partial: subagent events may supply views; retry/reassign/cancel/dependency APIs require source audit | Python worker/subagent execution + server facade |
| h | `c2`, `c2-channel`, `c2-session`, `c2-console` | Partial: provider sessions/commands exist; infrastructure/channel details, per-user grants, approval/expiry and session stop differ | Server C2 + provider/runtime + identity |
| s | `scenarios`, `workspaces` | UI/demo: launcher/walkthrough and mock reset remain explicit; not real deployment/workspace management | Browser demo |

### Panels and actions that route counts do not cover

- Project detail: overview, scope, operations, findings, reports, team and
  retained objectives/activity/plans/sessions/evidence/audit/close panels.
- Operation detail: logs/live, pending review/questions, assigned agents,
  timeline/results/graph, start/pause/resume/stop and emergency stop.
- AI/C2 detail: proposal/revision controls, branch actions, channel/session tabs,
  grant request/decision/revoke/renew and console commands.
- Forms: wizard validation, draft state, uploads, dirty guard, save failure and
  conflict behavior. List filters/search/pagination must use supported semantics.

## 4. Route-less surfaces and old-frontend retirement

| Surface | Required integration | Existing support / gap |
|---|---|---|
| Shell/project switcher/search/badges | API-backed accessible projects and scoped aggregate/search views | Snapshot-based reads today; backend aggregate contracts incomplete |
| Header notifications | Persisted notices, unread state and relevant updates | No equivalent notice API in inspected registry |
| Copilot drawer | Real scoped thread/context and actual output | Runtime conversation APIs can be adapted; no seed fallback |
| Emergency stop overlay | Authoritative scope, request/reason and stop outcomes | Per-run cancel exists; workspace/project/global stop is not proven equivalent |
| Identity/profile/theme/toasts | Trusted identity; UI-only preferences vs persisted settings clearly separated | Theme/toasts can stay local; roles cannot be client-authoritative |
| Demo walkthrough/reset | Mock-only provider and isolated dataset/timers | Must not dispatch real commands or erase real caches/data |
| Old planning/handoff UI | Preserve Soundwave/readiness/handoff behavior in new project/AI flows | Backend contracts exist; new placement is D6 |
| Old campaigns UI | Excluded from new UI per D5 (2026-10-14); API/provider behavior retained; required placement owned by 12 | Old consumers retire with the old app in 02 |
| Old vault UI | Excluded from new UI per D5; encrypted secret API retained; required placement owned by 16 | Old consumers retire with the old app in 02 |
| Old members UI | Excluded from new UI per D5 until ticket 07 implements the approved identity model (D1: single-user until R06, multi-user implemented in 07) | Old consumers retire with the old app in 02 |
| Old tests/tools/docs | Separate visual fixtures from contract/deployment regressions | Port useful backend/runtime assertions; do not blindly delete all old Web tests |

## 5. Requirement coverage and ownership

These are specification requirement IDs, not ticket IDs.

| Requirement | Covered surfaces | Primary ownership / dependency |
|---|---|---|
| R01 | Directory replacement, workspaces, locks, production config | Integrator/tooling; server preservation |
| R02 | Mock/real bootstrap, demo routes/reset | Browser providers; separate transport authorities |
| R03 | Login, team, role controls, scoped APIs | Server identity/access; D1 |
| R04 | Sync projections, Query reads, mutation invalidation | Browser feature read models and data-boundary owner |
| R05 | API DTOs/errors, pagination, timestamps, browser transport | Shared-contract owner + server routes |
| R06 | Project -> planning/readiness -> run -> events -> findings | Server runtime integration + browser project/AI/operation flows; D2/D6 |
| R07 | Request recovery, SSE replay, refresh/history | Ownership ledger + stream consumer |
| R08 | Preflight, ROE/plan/grant approvals, stop and closure | Server governance + Python execution; D1/D2/D3 |
| R09 | All feature reads/writes + unplaced old backend flows | Owning feature services; D3/D4/D5 |
| R10 | 53 routes, shell, forms, loading/errors/a11y/themes | Browser feature owners |
| R11 | CI/build/deploy, migrations, preserved data and bindings | Integrator/deployment owner |
| R12 | Scoped tests, live E2E, performance and coverage closure | Each changed feature + final integrator |

## 6. Acceptance evidence to collect during implementation

| Area | Minimum evidence |
|---|---|
| Mode isolation | Mock works without server; real startup/outage shows no seed rows, synthetic results or demo timers |
| Identity/scope | Trusted identity; foreign IDs/streams refused; scope-switch late read cannot leak |
| Persistence | Supported write survives browser refresh and API restart through its owning store |
| First vertical slice | Engagement + planning readiness + owned run + stream + produced finding/artifact, with one refusal/error path |
| Commands/recovery | Stable request IDs, concurrent duplicate handling, uncertain timeout/reconcile, refresh without duplicate dispatch |
| Runtime controls | Interrupt questions restored; cancel acceptance distinct from verified final state; unsupported controls explained |
| Governance | Four-eyes/versions/ROE invalidation, plan/grant deadline -1/0/+1, edited window and server-owned off-page deadlines |
| Evidence/reporting | Producer/source metadata truthful; capture integrity distinct from claim truth; review/export/delivery not conflated |
| Routing/UX | Required route keys plus real IDs, bad/foreign IDs, tabs/local-state scopes, dirty save/discard/cancel, history/base-path probes |
| Deployment | UI/API independent builds, same-origin API/SSE, persisted data retained after cutover |
| Performance | Cold authenticated asset closure and interactive samples include required lazy chunks and reported API latency |

Ticket 01 resolves D1-D6, names endpoints/storage for required gaps and records
approved exclusions before dependent implementation. Existing/Partial/Gap describes
today's support; it must not become a completion checkbox without code and evidence.

## 7. Approved 18-ticket delivery graph

Tickets are domain work packages, not a mandate for one oversized PR each. Read
execution.md for bounded patches, evidence reuse and the no-default-full-suite rule.
All status starts at ready-for-agent; only a ticket with completed blockers is
schedulable. Ticket 01 is the initial frontier.

| Ticket | Deliverable | Blocked by |
|---|---|---|
| [01 Decisions/contracts](issues/01-integration-decisions-and-contracts.md) | D1-D6, real feature scope, source-of-truth and API gaps | None |
| [02 Cutover/packaging](issues/02-frontend-cutover-and-packaging.md) | Canonical new UI, preserved server and working mock baseline | 01 |
| [03 Real bootstrap/projects](issues/03-real-bootstrap-and-projects.md) | Mode/capabilities/identity, engagement CRUD and scoped selection | 02 |
| [04 Planning/conversations](issues/04-planning-and-ai-conversations.md) | Planning thread/docs/readiness/handoff, history and copilot | 03 |
| [05 Execution/recovery](issues/05-execution-streaming-and-recovery.md) | Run dispatch, SSE/trace, question/HITL handling and recovery | 04 |
| [06 Observed outputs](issues/06-observed-results-and-evidence-reads.md) | Findings/evidence, assets, timeline/results/graph reads | 05 |
| [07 Identity/team](issues/07-identity-roles-and-team.md) | Implement approved multi-user identity/authorization (D1) and membership model; place members UI | 03 |
| [08 Scope/assets/ROE](issues/08-scope-assets-and-roe-governance.md) | Persistent scope/import/classification/review and version invalidation | 07 |
| [09 Governed operations](issues/09-plans-preflight-and-operation-controls.md) | Plans/approval expiry, preflight, lifecycle/schedule and stop | 05, 08 |
| [10 Finding authoring](issues/10-finding-lifecycle-and-evidence-authoring.md) | Curation/lifecycle, uploads/references and draft persistence | 06, 07 |
| [11 Reports](issues/11-report-lifecycle-and-delivery.md) | Editor/review/version pinning and export/delivery | 10 |
| [12 C2](issues/12-c2-grants-and-console.md) | Provider sessions/channels, grants, console and command recovery | 07, 08 |
| [13 Fleet/fanout](issues/13-agent-fleet-and-fanout.md) | Real fleet/worker/branch views and required controls | 05 |
| [14 Library/analysis](issues/14-playbooks-and-analysis.md) | Playbooks/techniques/review and observed analysis | 06, 08 |
| [15 Overview/inbox](issues/15-command-center-tasks-and-notifications.md) | Command Center/Tasks, notices, scoped search/badges | 09, 11, 12 |
| [16 Settings/audit](issues/16-settings-and-audit.md) | Approved settings writes and authoritative audit | 07 |
| [17 Closure](issues/17-project-closure.md) | Checklist, independent decision, final state and read-only gates | 09, 11, 12 |
| [18 Deploy/acceptance](issues/18-deployment-and-final-acceptance.md) | Final deployment, coverage/evidence and performance | 13, 14, 15, 16, 17 |

### Route and action owners

| Surface | Owning ticket(s) |
|---|---|
| Login/identity and system pages | 03 bootstrap; 07 identity; 02/18 route preservation |
| States/scenarios/workspaces and demo reset | 02 retains mock-only behavior; 03 isolates real mode; 18 verifies disposition |
| Command Center/My Tasks | 15 |
| Projects/wizard/switcher | 03; extended scope/assets/team by 08/07 |
| Project detail panels | 03 overview shell; 04 planning/docs; 08 scope/assets; 09 operations/plans; 10 findings/evidence; 11 reports; 07 team; 12 sessions; 16 audit; 17 close |
| Operations/preflight/schedule/detail/stop | 05 real run console/recovery; 09 governed business lifecycle; 06 results/graph; 13 workers |
| Agents/agent detail and AI fanout/branch | 13; minimal operation-readiness inputs by 09 |
| Assets/detail/import/scope | 06 observed reads; 08 operator-managed records/import/governance |
| Playbooks/playbook/technique/review and analysis | 14; minimal preflight library inputs by 09 |
| Findings/finding/new and evidence/inspector | 06 initial reads; 10 authoring/lifecycle/integrity workflows |
| Reports/new/editor/preview/review | 11 |
| AI workspace/history/copilot | 04; execution/questions/HITL by 05 |
| AI plan/review/compare | 09; runtime planning documents by 04 |
| AI trace | 05; provenance sources by 06 |
| C2/channel/session/console | 12 |
| Settings/profile/org/integrations/policy/retention/audit | 16; trusted roles/team by 07 |
| Header notices/search/badges | 15; project selection bootstrap by 03 |
| Campaigns/vault old-frontend disposition | 01 approves placement/exclusion; 12 owns required provider/campaign placement, 16 required vault/settings placement; 02/18 own retirement |
| Packaging/CI/proxy/build and persistence cutover | 02, 18; each feature owns its migrations/persistent writes |

### Requirement-to-ticket ownership

| Requirement | Implementation / acceptance owners |
|---|---|
| R01 | 02, 18 |
| R02 | 02, 03; mock isolation inherited by every real feature |
| R03 | 03, 07; scoped enforcement in 04-17 |
| R04 | 03 initial seam; each real read/write owner 04-17 |
| R05 | 01 contract decisions; 03 initial transport; feature extensions 04-17 |
| R06 | 03, 04, 05, 06 |
| R07 | 04, 05, 12, 13 |
| R08 | 07, 08, 09, 10, 11, 12, 14, 16, 17; actual tool HITL by 05 |
| R09 | 03-17, with D3-D5 owned by 01 |
| R10 | 02 initial preservation; each feature's affected routes; 18 residual acceptance |
| R11 | 02, 18 and feature-owned schema/migrations |
| R12 | Every ticket's selected checks; 18 reconciles evidence without default full reruns |

The first usable real flow ends at 06. Continue the other frontier tickets toward
full approved parity. A ticket does not complete a required domain merely by
rendering an unavailable state; an exclusion must be explicitly approved in 01.
