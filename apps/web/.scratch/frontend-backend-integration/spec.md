# Spec: integrate the new Web UI with the Raptix system

Status: decisions resolved (ticket 01, 2026-10-14, section 8); delivery follows
the requester-approved 18 work packages under `issues/`.

Companions: [coverage.md](coverage.md) inventories routes, API support and gaps;
[execution.md](execution.md) defines delivery and verification rules.

## 1. Goal and scope

Replace the existing browser application in `apps/web` with the interface now in
`apps/web-improve`, rename the new application to `apps/web`, and connect it to
the existing Fastify server and Python runtime. Preserve the new visual baseline,
navigation and explicit mock mode while making real mode use authoritative data
and execution outcomes.

"Remove the old Web" means retire its browser implementation, not delete the
server, Prisma migrations, runtime integrations or shared contracts it contains.
This specification supersedes the old Web's 13-page visual baseline for the new
frontend. It does not supersede runtime ownership or enforcement rules.

Two milestones must be distinguished:

- **Usable real integration:** the R06 end-to-end flow works;
  unsupported functionality is visibly unavailable, with no mock fallback.
- **Full integration:** every surface in coverage.md has a verified real
  implementation or an explicitly approved exclusion. The first milestone alone
  is not full parity with the 53-route demo.

## 2. Source-verified starting point

Audit date: 2026-10-14. These are source observations, not claims that a live
backend stack was exercised during this documentation task.
In the table, frontend `src/` paths are relative to `apps/web-improve` and
`server/` paths are relative to `apps/web`.

| Surface | Current implementation | Consequence |
|---|---|---|
| New frontend | `apps/web-improve/src/router/registry.tsx`: 53 route keys across a/b/c/d/e/f/g/h/s | Preserve this inventory, not the old Web's sidebar |
| Data seam | `src/domain/service-factory.ts` exposes `authority`, `MockClock`, schedules and scoped handlers | It is a mock implementation, not an HTTP-ready interface in its entirety |
| Sync reads | `src/state/console.ts`, `src/domain/projection.ts` and feature projections read authority snapshots | Replace snapshot dependencies in real mode, not only asynchronous handlers |
| Backend composition | `apps/web/server/src/main.ts` -> `src/app.ts:buildApp` | Retain and extend this server |
| Identity | `server/src/auth/identity-provider.ts`: fixed `local` identity | Six demo roles and persona switching are not real authentication |
| Members | `server/src/services/members-service.ts`: local operator; invite/remove unsupported | This is not a membership/RBAC backend |
| Approvals | `server/src/services/approvals-service.ts`: workspace-backed tool HITL allow/deny | Not equivalent to ROE, plan, report, closure or grant approvals |
| Findings/assets | Workspace finding projections; graph-backed asset reads | No matching finding lifecycle or asset-scope CRUD is established by those GET APIs |
| Reports | `server/src/services/export-service.ts`: engagement JSON/Markdown export | Not the demo's report editor, independent review or delivery workflow |
| Runtime | Owned threads/runs, request ledger, SSE and interrupt resume | Adapt these semantics rather than assuming demo operation states match |
| Tooling | Root npm workspace includes `apps/web` and `apps/web/server`, not `apps/web-improve` | Workspace and lockfile cutover is required |

Existing routes are registered conditionally according to configured services.
An endpoint declaration is not proof that it is available in a deployment.
Use `/api/capabilities` and readiness responses as well as real requests.
The current readiness endpoint checks dependency wiring, not model inference,
tool execution or provider operations; it cannot replace an execution smoke.

## 3. Ownership and target architecture

```text
apps/web (new React UI)
    | same-origin HTTP /api + scoped SSE
    v
apps/web/server (Fastify API)
    | public runtime HTTP API / provider integrations
    v
packages/raptix/raptix (Python execution and orchestration)
```

| Responsibility | Owner after cutover |
|---|---|
| Routes, rendering, forms, UI-only state | `apps/web/src/` |
| HTTP adapter, Query read models, stream consumption | Feature modules and a shared browser transport within `apps/web/src/` |
| Public wire DTOs, validators, errors and event contracts | `apps/shared/web-contracts/src/` |
| Shared SSE parsing/event utilities | `apps/shared/streaming/` |
| API routes and request validation | `apps/web/server/src/http/`, existing `security/` modules |
| Web business workflows, repositories and runtime adapters | `apps/web/server/src/services/`, `repositories/`, `integrations/` |
| Web database schema and migrations | `apps/web/server/prisma/` |
| Agent execution, mission state, ROE and sandbox enforcement | Owning Python subsystems under `packages/raptix/raptix/` |

PostgreSQL owns persisted Web records and request ownership; runtime checkpoints
own thread/run state; workspace artifacts and the engagement knowledge graph
retain their existing evidence/knowledge ownership. Query is a browser cache,
not another database authority. Do not copy all runtime state into Prisma or
treat the demo `Db` as a production schema.

New public API or subsystem boundaries require a Proposed ADR before code,
following CONTRIBUTING_AGENT.md. No new boundary is implemented by these files.

## 4. Domain mapping rules

| UI concept | Existing system concept | Required treatment |
|---|---|---|
| Project | Engagement DTO + workspace slug | Use server IDs and distinguish ID, display name and workspace slug; wizard fields exceed the existing contract |
| Operation | Bound thread and runtime run | Mapping is unresolved: a persisted business operation may span several runs; never assume 1:1 |
| AI chat/history | Planning or execution thread, checkpoint messages | Preserve thread kind, assistant binding and pending questions |
| AI plan | Planning documents/OPPLAN plus proposed plan workflow | An OPPLAN document is not automatically an independently approved, expiring UI plan |
| Agent | Runtime assistant graph, subagent/worker or deployed endpoint | `/api/agents` returns graph IDs, not the demo fleet's host heartbeat/allocation model |
| Approval | Tool HITL decision, graph interrupt or business approval | Keep these identities and transitions separate |
| Finding/evidence | Recorded claim, workspace source, evidence reference | Preserve source, parser-quality flags, producer lineage and capture integrity vocabulary from GLOSSARY.md |
| C2 session | Provider session + command ledger | Connected does not imply authorization; provider sessions do not establish timed per-user grants |
| Report | Existing engagement export vs new report lifecycle | Export completion is not review approval or delivery acknowledgement |

Status translation must retain raw status and provenance when useful. Unknown
runtime/provider status must remain unknown. A runtime interrupt is not a generic
pause, `/resume` answers pending graph questions, and cancellation acceptance is
not proof that every operation, worker or C2 session has stopped.

## 5. Integration requirements

### R01. Frontend replacement and packaging

- Canonical destination: new frontend at `apps/web`; server remains at
  `apps/web/server`. Preserve server source, schema, migrations and tests.
- Keep workspace names `@raptix/web-raptix` and `@raptix/web-raptix-server` unless a
  separate naming decision explicitly changes downstream consumers.
- Use the root npm workspace/lockfile after cutover. Reconcile the app-local
  lockfile and differing Vitest/ESLint versions deliberately.
- Production Vite/HTML must not require `.figma` plugins or site configuration.
  Retain the dev `/api` proxy and production proxy's unbuffered SSE behavior.
- Carry this planning directory and necessary refactor history with the rename.
  Retire old frontend consumers only after replacement behavior is verified.

### R02. Explicit mock and real modes

- Select mode before creating providers/transports and display it clearly.
  Mock mode remains standalone with deterministic seed data and demo scenarios.
- Real mode never seeds the demo authority, runs demo timers, performs simulated
  successful commands or falls back to mock after a backend failure.
- Missing capability, configuration or authorization renders an actionable
  unavailable/refusal state. An empty result means no records, not a failed read.
- Switching mode/session/scope disposes subscriptions and clears incompatible
  caches. A demo reset must never mutate a real engagement.

### R03. Identity, ownership and authorization

- Resolve identity and deployment mode from a trusted server-side mechanism.
  Never accept a demo persona/role from the browser as authorization.
- Initially supported local-single-user deployment stays explicitly local. Do
  not describe its persona selector as login or its member list as real RBAC.
- Multi-user roles, memberships and four-eyes approvals require the identity
  decision in section 8 and server enforcement before those workflows are enabled.
- Every scoped read, mutation, artifact and stream must verify ownership/access.
  Foreign or missing IDs must not expose the row or its sensitive metadata.

### R04. Browser data boundary

- Reuse async feature contracts where semantics match; separate real feature
  ports from mock-only `authority`, `reset`, `MockClock`, schedules and commits.
- Migrate sync identity/project/feature projections to scoped API-backed read
  models with loading/error states. Do not emulate `snapshot()` with a second
  browser database or directly import server/Prisma/filesystem code.
- Query keys include mode, trusted identity, engagement and applicable resource
  IDs/filters. Superseded reads and old stream callbacks cannot restore previous
  scope visibility. Mutations capture their intended scope once.
- Invalidate related views after authoritative acknowledgements; speculative UI
  updates must not fake approval, successful execution, stop or delivery.

### R05. Contracts and transport

- Extend `@raptix/web-contracts` only where verified existing contracts are
  insufficient; validate wire responses at the boundary.
- Keep existing `/api/engagements` naming. New URLs, methods and resource models
  are proposed during contract design, not assumed to exist by this spec.
- Define errors, pagination/filter semantics, timestamps/timezones, concurrency
  versions and command request IDs before wiring their controls.
- Browser accesses same-origin `/api`; runtime URLs, secrets, workspace paths
  and provider credentials stay server-side. API errors never become SPA HTML.

### R06. First real execution flow

- Create/list/select an engagement, then establish verified runtime context.
- Run planning through the appropriate thread when required; read planning
  readiness before exposing execution. Do not bypass the existing handoff.
- Create/recover an owned execution thread and submit a run with a stable
  request ID. Consume actual scoped events and display pending questions/HITL.
- Expose cancellation and graph-interrupt resume according to their actual
  contracts. Unsupported pause/schedule/global-stop controls remain unavailable.
- Show produced findings/artifacts from the owned engagement; a run with no
  findings must render an honest empty state.

### R07. Streaming, recovery and command consistency

- Track engagement/thread/run/event identities; use the existing cursor and
  provenance contracts. Never label historical thread events as current-run work.
- On stream close/error, reconcile authoritative run/thread state and reconnect
  where supported. Deduplicate replayed events without losing final outcomes.
- Refresh restores server-backed state without silently creating another thread
  or run. Unmount/disconnect closes the subscription, not the runtime run.
- Retry uncertain dispatch using the same request ID and recovery ledger. A
  timeout is uncertain until reconciled, not permission to dispatch a duplicate.
- Preserve all pending parallel questions and their interrupt identities.

### R08. Governance and operational invariants

- Port required governance behavior to its server/runtime enforcement site;
  frontend disablement is only an explanation of the authoritative decision.
- Scope revisions, approval versions, four-eyes checks, absolute plan/grant
  deadlines, preflight/edited ROE windows and closure prerequisites need real
  persisted contracts before claiming parity with the demo.
- Check deadlines at `now >= expiresAt`, including commands in flight. Sweeps
  are server/runtime-owned cleanup, never authorization grace periods or
  browser-page lifecycles.
- Keep policy, approval and execution facets distinct. AI proposals cannot grant
  approval. Emergency-stop outcomes retain failed/unknown/manual-confirm states
  and cannot automatically resume.
- Existing runtime guardrails remain authoritative. This spec authorizes no
  weakening of ROE, egress, HITL, sandbox or engagement-context controls.

### R09. Feature workflows and persistence

- Account for all routes and route-less shell actions in coverage.md. A GET list
  endpoint does not satisfy the corresponding editor/lifecycle workflow.
- Preserve runtime evidence and add explicit Web workflow storage only for
  approved domain gaps. Define source-of-truth and revision/concurrency rules.
- Supported writes survive browser refresh and server restart through the
  owning persistent store. Scope switching cannot retarget an in-flight write.
- Backend functions with no equivalent new screen (campaigns, vault, members)
  retain their APIs; frontend disposition requires an explicit decision.

### R10. UX continuity

Preserve the new visual baseline, 53-route inventory, hash deep links, navigation
history, light/dark themes, keyboard access and unsaved-change guards. Real mode
must handle slow/failed reads, empty datasets, conflicts and expired permissions
without falling back to demo visuals/data. Missing or malformed route IDs must
be recoverable. Filters/tabs keep their documented initial-URL/local-state scope
unless separately changed.

### R11. Deployment and cutover

Keep independent UI/server builds, explicit database/runtime/workspace env
configuration and explicit Prisma generation/migration. Update affected root
scripts, CI filters, Dockerfiles, Compose/proxy and launcher/desktop consumers.
Do not rename image/service identifiers merely because the source directory
changes. Existing volumes, engagement IDs, workspace paths and thread bindings
must remain usable after cutover; rollback must not discard persisted data.

### R12. Verification and acceptance

Each milestone requires source-linked contracts, focused tests and a live success
and refusal/error path through the layers it changes. Final acceptance requires
the new UI against the real API/runtime, persistence/recovery evidence and route
dispositions reconciled with coverage.md. See execution.md for test selection.

Re-measure cold authenticated-load transfer including every required JS/CSS
asset, including dynamic route chunks needed before readiness. The earlier demo
bundle result alone does not certify real-mode performance. Retain the <200,000
gz-byte frontend target; declare five cold interactive samples and a <3 s target
under the stated network/CPU profile, separating readiness from quiet-window TTI
and reporting backend latency. Changes to these budgets require an explicit
decision, not exclusion of required chunks.

## 6. Planning scope

This tracker specifies work and now contains the approved local tickets. It does
not perform implementation, folder deletion/rename, schema migration, new endpoint,
commit or push. A wholesale backend rewrite, redesign of the UI and import of
fake demo people/data into a real database are not integration prerequisites.

## 7. Delivery order (milestones, not tickets)

1. Resolve identity/domain/storage decisions and freeze API compatibility maps.
2. Prepare bounded packaging/cutover changes; preserve the server and mock demo.
3. Establish real transport, capabilities, identity and scoped read foundations.
4. Deliver R06 end-to-end with real runtime execution, streaming and recovery.
5. Extend feature/governance workflows in independent vertical slices.
6. Verify real deployment and retire old frontend paths after coverage closure.

## 8. Decisions owned by ticket 01 — RESOLVED by requester, 2026-10-14

| Decision | Resolution |
|---|---|
| D1: identity/release scope | Single-user local integration for the R06 milestone (tickets 02-06). Multi-user identity/authorization is **implemented** in ticket 07, which must begin with that work before enabling any independent-approver workflow; no role/team/login claim ships before then. |
| D2: operation/plan model | Runtime engagement/thread/run identities only; no separate persisted business-operation record until a real need is approved. Planning documents stay planning artifacts; business plan approval/expiry behavior is governed by ticket 09 from persisted web workflow records, not relabeled OPPLANs. |
| D3: write ownership/storage | Full lifecycle schema now: the complete web workflow lifecycle Prisma schema is **designed up front** as the storage target (ADR-0069), migrations land incrementally from that frozen design per owning ticket; runtime/KG/workspace remain evidence producers; demo `Db` is never migrated. |
| D4: real feature scope | Staged to the approved 18 tickets: R06 end-to-end first (tickets 02-06); other surfaces render honest unavailable states in real mode until their owning ticket (07-17) lands; capability gating is transitional, not a permanent substitute. |
| D5: old backend-only UI flows | Exclude UI now, place later: campaigns -> ticket 12, vault -> ticket 16, members -> ticket 07; APIs and data retained; old frontend consumers retire with the old app in 02; real mode marks these surfaces unavailable until placement. |
| D6: initial planning UX | New AI workspace/project flow exposes Soundwave planning, readiness and handoff; no invented approval equivalence (per D2). |

Recorded boundaries: ADR-0068 (browser real-mode data boundary) and ADR-0069
(web workflow lifecycle storage), both Proposed until their first implementation
lands. Decisions bind dependent tickets; later changes require a requester
decision recorded here.
The approved 18-ticket graph is indexed in coverage.md. Required API/storage gaps
and approved feature exclusions must be assigned to an existing owning package;
any expansion of the tracker requires requester approval. Keep bounded patches
within each work package rather than splitting every screen/test into a ticket.
