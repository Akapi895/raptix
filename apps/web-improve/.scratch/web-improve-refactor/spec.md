# Spec: Raptix Web — Production Refactor of the Figma Make Export

Status: ready-for-agent

Execution gate: complete the Git/worktree prerequisites in [execution.md](execution.md)
before starting implementation. This status means the work is specified, not that prerequisites
have already been satisfied. The executable graph is the 69 numbered leaves in `issues/`;
[coverage.md](coverage.md) maps stories and the superseded 24-ticket breakdown to that graph.

Companion document: `implementation-plan.md` (§ references below). This spec incorporates
source-verified corrections from the 2026-10-13 codebase audit (knowledge-graph analysis of
`apps/web-improve`). Where this spec and the plan disagree on current-state facts, **this spec
wins** — the plan's §1 counts were produced before verification.

## Problem Statement

The team owns a functionally rich Red Team management UI (30+ screens: engagements, AI-assisted
operations, C2 session governance, reporting) that exists only as a Figma Make export. It works
as a demo but cannot be developed further: all state lives in one monolithic context store,
every screen imports directly from three shared files, navigation is hand-parsed URL hashes,
business logic is computed inline in components, there are no tests, no error boundaries, and
no data-fetching boundary — the whole "database" is a single `seed()` object passed through
Context. Every new feature multiplies the risk of breaking an operational safety behavior
(gated execution, emergency stop, four-eyes approvals, scope isolation) that is currently
enforced only by scattered inline checks.

## Solution

Rebuild the app in place following the feature-first architecture in `implementation-plan.md`
§2: feature modules per domain area, a typed mock service layer behind a single factory seam,
Zustand for cross-cutting UI state, TanStack Query for entity data, React Router with lazy
routes, React Hook Form + Zod for forms — while preserving, as hard observable requirements,
all operational safety requirements listed in §1.7 plus scope re-validation and 24-hour
approval expiry. Scope re-validation is implemented today; approval expiry is a target
requirement with incomplete enforcement in the export. The demo remains fully
functional throughout; each roadmap phase (P0–P4) ships as independently mergeable work.

## User Stories

1. As any user, I want to sign in by selecting a demo persona, so that I experience the app with the permissions of my role.
2. As any user, I want dedicated system pages (403, 404, 500, offline, session expired), so that failures are self-explanatory instead of blank screens.
3. As any authenticated user, I want an app shell with sidebar navigation and a header, so that every feature is reachable consistently.
4. As any authenticated user, I want a project switcher, so that everything I see is scoped to one engagement or to all my accessible engagements.
5. As any user, I want to be warned before navigating away with unsaved form changes, so that I never lose work silently.
6. As a Client/Viewer, I want mutating controls hidden or disabled with an explanatory reason, so that I understand what my role cannot do instead of hitting errors.
7. As a Red Team Manager, I want a command center with KPI stats, a readiness checklist, a completion tracker and an activity feed, so that I can judge engagement health in one screen.
8. As any user, I want a My Tasks inbox grouping pending approvals, assigned findings and active operations, so that I know what to act on next.
9. As a Red Team Manager, I want a filterable project portfolio with CSV export and pinning, so that I can manage a growing portfolio.
10. As a Red Team Manager, I want a guided 5-step project wizard (info → objectives → scope/ROE → assets → team + review), so that no project is created without its ROE essentials.
11. As a Reviewer, I want approval requests showing the diff and a reason field, so that I can approve or return changes with full context.
12. As a Red Team Manager, I want scope edits on an approved project to bump the ROE version and require re-approval, so that scope creep cannot slip through silently.
13. As a Red Team Manager, I want a project detail page with overview, scope, operations, findings, reports and team tabs, so that everything about an engagement lives in one place.
14. As a Red Team Manager, I want a closure checklist that blocks closure until operations ended, sessions terminated, findings dispositioned, report delivered and approvals cleared, so that projects never close half-done.
15. As a Reviewer/Admin, I want to confirm or reject closure requests, so that closure follows the four-eyes principle.
16. As an Operator, I want an operations list with status/technique filters and categorized counts, so that I can find the operation I need.
17. As an Operator, I want an operation wizard that selects project, playbook, agents and assets, so that operations start correctly configured.
18. As an Operator, I want an 8-point preflight page that must fully pass before start, so that no operation runs without approved ROE, in-scope targets, healthy agents, an approved plan, a time window and an emergency contact.
19. As an Operator, I want start/pause/resume/stop controls each with confirmation and reason, so that execution-state changes are deliberate and audited.
20. As a Red Team Manager, I want an Emergency Stop scoped to operation, project or workspace with a mandatory reason, so that I can halt activity instantly within my authority.
21. As any user, I want Emergency Stop to progress requested → acknowledged → stopped with explicit failed/unknown outcomes and a manual "confirm stopped" path, so that I never see fake success.
22. As any user, I want emergency-stopped operations and sessions to never resume automatically, so that re-verification is always a human decision.
23. As an Operator, I want a live console with step logs and a "review required" gate where the AI cannot approve, skip or reject, so that execution stays human-supervised.
24. As an Operator, I want results and execution-graph tabs, so that I can see what ran, in what order, with evidence.
25. As an Operator, I want a fleet view of agents with status and project allocation, so that I can staff operations.
26. As an Operator, I want agent detail with health sparklines, capabilities and operation history, so that I can diagnose agent issues.
27. As an Operator, I want an asset catalog with bulk import and in/out/pending scope classification, so that scope is always explicit per asset.
28. As a Red Team Manager, I want in-scope asset additions on an active project to trigger an ROE approval and expire stale approved plans, so that execution always follows the current ROE.
29. As an Operator, I want a playbook library with technique detail and a revision review workflow where I cannot review my own revision, so that tradecraft is versioned and independently approved.
30. As an Analyst, I want an MITRE ATT&CK matrix with coverage overlay and a detection heatmap, so that I can analyze technique coverage.
31. As an Analyst, I want an attack-path graph built only from observed events, so that no path is ever inferred when execution data is missing.
32. As an Operator, I want a findings inventory with severity breakdowns and filters, so that I can triage findings quickly.
33. As an Operator, I want the full finding lifecycle (draft → review → confirmed → remediation → retest → resolved) with role gates, so that findings are processed consistently.
34. As an Operator, I want AI-suggested findings importable into drafts, so that AI output remains a proposal I curate.
35. As an Operator, I want evidence items with recorded integrity hashes, so that findings reference verifiable captures.
36. As a Red Team Manager, I want a report catalog with templates and delivery history, so that reporting is managed end to end.
37. As an Operator, I want a section-based report editor with finding selection, so that reports are composed from verified findings.
38. As a Reviewer, I want report review with approve/return and mandatory comments, where the reviewer can never be the author, so that the four-eyes principle holds for every report.
39. As a Reviewer, I want report approval to pin the version, so that approved content cannot drift.
40. As a Red Team Manager, I want export and delivery recorded as separate audited steps, so that distribution is traceable.
41. As any AI-using operator, I want an AI chat workspace with Observe/Propose/Execution modes that never grant permission by themselves, so that AI assistance stays within policy.
42. As any user, I want AI plans to exist only as proposals (draft/proposed → review), so that nothing executes until a human approves.
43. As a Reviewer, I want plan review showing reviewer, justification, ROE binding and a 24-hour approval expiry, so that plan approvals are deliberate and time-bounded.
44. As a Reviewer, I want a plan version diff view, so that I can see exactly what changed between revisions before re-approving.
45. As any user, I want tool events displayed with Policy, Approval and Execution as independent facets, so that "Policy Allowed" is never mistaken for "Executed".
46. As any user, I want conversation history with search and pinning, so that AI provenance is retrievable.
47. As an Operator, I want a multi-agent fanout overview with branch timelines and retry/reassign/cancel actions, so that parallel AI work is controllable.
48. As an Operator, I want a worker graph of AI branches with dependencies, so that fan-out execution is legible.
49. As any user, I want a C2 overview with infrastructure, channels, sessions, requests and audit tabs, so that session infrastructure is inspectable.
50. As an Operator, I want interactive session access only through an approved, time-limited, per-session grant with a visible countdown, so that interactive control is tightly bounded.
51. As an Operator, I want the session console to lock input the moment my grant expires and offer renewal, so that access cannot outlive its approval.
52. As an approver, I want to approve/return/reject access requests but never my own, so that session access follows the four-eyes principle.
53. As an Organization Admin, I want settings tabs for profile, organization, integrations, policies, retention and audit log, so that workspace governance is configurable.
54. As an Organization Admin, I want a searchable, filterable audit log of every consequential action with actor, reason and timestamp, so that compliance questions answer themselves.
55. As any user, I want notifications grouped in the header, so that approvals and operational events reach me in time.
56. As any user, I want a context-aware copilot drawer, so that assistance understands the screen I am on.
57. As a demo user, I want a scenario launcher and a guided walkthrough, so that I can showcase the product's safety behaviors quickly.
58. As a developer, I want lazy-loaded routes and per-feature error boundaries, so that one feature crash cannot take down the whole app.
59. As any user, I want loading skeletons, empty states, keyboard navigation and working dark mode everywhere, so that the app feels production-grade.
60. As a developer, I want semantically named feature modules replacing lettered screen files, so that the codebase is navigable and the diff budget is enforceable.

## Implementation Decisions

- **Stack (plan §2.3):** keep React 19, TypeScript, Vite 8, Tailwind v4, Lucide. Add React Router v7, Zustand, TanStack Query, React Hook Form + Zod.
- **Structure (plan §2.2):** feature-first modules under the agreed folder layout; all 35 screen files (including the standalone scenarios launcher and demo guide) become semantically named feature modules; shared UI primitives (~40, plan §3.1) are extracted one-per-file with a barrel export.
- **Single data seam (plan §2.6):** a service-layer factory exposing per-entity handlers with the same async contract for mock and (future) real implementations. The monolithic `seed()` stays only as the mock layer's data source, split behind per-entity handlers with simulated latency. No component ever touches the in-memory database directly.
- **Migration authority:** one canonical in-memory database serves both legacy Context and new services. The bridge owns snapshots, transactions and change notifications; legacy actions write through it, new handlers use the same transactions, and Query observes committed changes. Create only the handlers needed by each feature ticket. Full handler extraction is not a foundation mega-ticket. See execution.md for reset, actor, cache and concurrency rules.
- **Routing:** React Router with lazy route modules replaces manual hash parsing. The new route inventory must cover **53 route keys across 9 groups** (the plan's §1.4 table claims 42 and must not be used as the checklist): it includes, besides the obvious ones, `operation-schedule`, `technique`, `asset-scope`, `playbook-review` and a dedicated evidence inspector; there is **no** `dashboard` route — the home page is the command center. Tab state moves to search params (plan §4.1).
- **State (plan §2.4):** five Zustand stores (auth, active project, theme, toasts, UI) plus TanStack Query for all entity data; local state stays in components. Rules: global stores only for cross-cutting concerns; no server data in Zustand.
- **RBAC:** port the existing role model — 6 roles and **19** permission actions (the plan says 18; verification counted 19, including emergency-stop) — into a shared permissions hook. Project-scoped access (`canAccessProject`), viewer read-only, and closed/cancelled read-only behavior are preserved exactly.
- **Safety targets and baseline:** the eight §1.7 requirements remain acceptance targets. Their current enforcement is spread across store actions, pure helpers and screens/hooks; it is not uniformly enforced by the store API. Preserve working behavior and close the identified gaps at real execution sites, with explicit regression ownership in execution.md. The service double supplies environment responses, not the enforcement under test.
- **Scope re-validation:** submitting an approved-scope revision immediately expires approved plans and resets ready operations to draft, clearing preflight. Added assets stay pending until independent ROE approval. Approval does not postpone invalidation until that later moment. Running operations retain the documented last-approved-scope behavior; they cannot target newly pending assets.
- **Approval expiry target:** a newly approved plan gets an absolute deadline 24 hours from the approval decision. At or after that deadline, execute/start/resume requiring that approval refuse it until independent re-approval. Merely storing/displaying `expires` is not enforcement. Seeded demo records retain their recorded deadlines; fake time makes scenarios deterministic.
- **Grant deadline target:** authorization checks the live grant and absolute expiry on every command. Input locks at the deadline through a deadline notification, and an in-flight simulated command rechecks before committing output. A 15-second sweep performs cleanup/audit only; it grants no grace period and runs without a C2 page mounted. Expiry revokes access, not the session connection itself.
- **Preflight target:** use the source's eight check identities (project, ROE, targets, time window, playbook, agents, required approvals, contact). Manual operations may remain planless when policy permits; plan-linked operations require valid approval. The source's always-passing time-window placeholder is replaced with deterministic domain evaluation, not characterized as existing enforcement.
- **Business logic extraction (plan Appendix A):** preflight, eligibility, readiness, completion and closure computations become pure domain functions in the operations/projects domain layer, unit-testable without React.
- **Tool-event model:** keep a single stored tool-event state whose Policy/Approval/Execution facets are derived at the service boundary (current verified behavior); the UI continues to present the facets as independent states. Do not invent a 4-field storage model in this phase.
- **Charts (plan §1.8 correction):** the zero-dependency SVG Donut, Bar and Line charts live in the shared UI primitives module (not the infrastructure screens module); the table primitive, agent heartbeat sparklines, attack-path graph and execution DAG keep their current homes. Preserve or rebuild all of them; no charting dependency.
- **SHA-256 correction:** the evidence inspector shows simulated capture integrity; the report preview has no checksums. Existing simulated checksums on report export records remain part of export/delivery history. Do not introduce checksums into report-preview content.
- **Quality gates (plan §6):** no TypeScript `any`; no direct `window.location` writes outside the router; no business logic in components; every destructive action confirmed with a reason; every list has search/filter/pagination/empty/loading states.
- **Process constraint:** repo contribution rules cap runtime diffs (≤400 lines, ≤10 files, one concern per PR) — each roadmap phase (plan §5) is delivered as a series of small PRs, not one drop.
- **Coverage and retirement:** Command Center, My Tasks, shared providers/stores and every project tab have explicit owners in coverage.md. The six agreed project tabs are mandatory; existing secondary tabs/deep links remain functional through service-backed panels. Retire legacy definitions incrementally as consumers migrate, leaving bounded wrapper-removal tickets at the end.
- **Delivery:** an integration branch is coordination, not authorization for one oversized PR. Land independently verified ticket-sized PRs; new dependency/manifests changes are isolated in the tooling ticket. Measure scope before editing and split an oversized leaf into real tracker files before marking it complete.

## Testing Decisions

- **Primary integration seam:** mount real router, stores and screens with a service double for rendered loading/error/gating behavior. Invariant enforcement tests instead call real actions/domain functions/mock handlers and replace only environment dependencies. Focused component tests cover interaction/accessibility behavior where useful, especially dialogs and tables; there is no requirement to isolate every primitive.
- **Continuity:** baseline tests characterize only behavior actually enforced today, at its current public execution site (including screens/hooks and `toolFacets`). Keep those expectations green while replacing their test adapters. Add failing-then-passing tests for missing enforcement in its owning implementation ticket; do not require those future tests to pass on the unchanged export or ship skipped/xfail cases to hide the gap.
- **A good test** asserts external, user-visible behavior: which route renders, which controls are enabled with which reason, which banners/status appear, what changes after an action. It never asserts store internals, hook call order, or private function shapes.
- **Coverage:** test families cover all ten safety requirements; each family has relevant allowed/denied/boundary cases, not an arbitrary ten-test ceiling. Cover the 6 × 19 RBAC matrix plus project membership and closed/cancelled contexts. Route-level rendered tests cover each feature group, with checks of real enforcement separate from returned service responses.
- **Determinism:** baseline tests install fake timers before importing the export's module-level clock. Migrated real handlers/domain logic accept the same controllable clock as services; both deadline timers and sweeps observe it. Test expiry at deadline−1, deadline and deadline+1, without mounting the relevant page. A clock inside only the service double is insufficient.
- **Prior art:** none exists in this app (verification confirmed zero tests), so the harness is greenfield: Vitest + React Testing Library with user-event. The repo's Python-side pytest conventions do not apply here; keep test files co-located per feature and named for the behavior they verify.
- **Checks:** the tooling ticket owns local npm scripts for typecheck, lint, build and non-watch tests. Every implementation ticket runs the execution.md checks and exercises its actual route with a success and refusal/error case. Final verification requires zero remaining type/lint diagnostics and the route/viewport/dark/accessibility/performance audits; Vite build alone is not a typecheck.

## Out of Scope

- Any real backend: HTTP clients, real auth/MFA/SSO, real policy engine, real C2 enforcement, real threat-intel ingestion. The mock service factory only must make swapping trivial (plan §2.6).
- Internationalization framework — UI copy stays English; no i18n plumbing.
- Below-768px mobile layouts (plan §4 gate is ≥768px).
- Runtime changes outside this app: CLI, web server, Go launcher, desktop app and Python packages. A new frontend-boundary Proposed ADR may be recorded at the repo's existing `docs/adr/` location; existing runtime ADRs are not rewritten.
- Replacing or enriching the demo dataset; the seed scenario system stays as-is.
- Real retention/legal-hold/delete semantics (retention tab stays simulated).
- Bundling the roadmap phases into large merges — phasing is part of the plan, not this spec.

## Further Notes

- **Glossary alignment:** when the service layer later swaps to a real API, findings/evidence vocabulary must converge with the repo-root `GLOSSARY.md` (recorded claim, evidence reference, capture integrity, producer lineage). The UI's "Integrity verified (simulated)" maps to *capture integrity*; findings record *claims*, not proven truth. Design service contracts so this mapping is mechanical.
- **ADRs:** the root `docs/adr/` applies to app work too. Record the new service/domain subsystem interfaces in a Proposed ADR before introducing them, following repo instructions. Weakening/reshaping safety constraints additionally requires the contribution rules' ADR/threat-model process; this spec does not authorize weakening.
- **Tracker:** this spec lives in the repo's local-markdown tracker; `/to-tickets` should break it into tracer-bullet tickets under this directory, one concern per ticket.
- **Verification basis:** the current-state numbers in this spec come from a full knowledge-graph analysis plus targeted source reads (routes, RBAC switch, preflight, emergency-stop machine, grants expiry loop, closure checklist, facet derivation). Re-run `/understand` after major milestones to keep the graph honest.

## Comments

- **2026-10-13 — seam confirmed with requester.** Service-layer contract accepted as the primary test seam, with one amendment: invariant tests run at the seam where each invariant's logic actually executes (store action API today, extracted domain functions/service handlers after migration), and the suite must pass unchanged across the transition. Spec updated accordingly; minor reference fix applied ("35 lettered screens" → all 35 screen files). Status remains ready-for-agent.
- **2026-10-13 — readiness correction.** Supersedes the store-only interpretation above: some baseline logic lives in UI/hooks; 24-hour enforcement is incomplete. Added one-authority migration, deadline semantics, missing surface owners, tooling/ADR prerequisites and bounded leaf tickets. Git baseline/worktree preparation remains an execution prerequisite, not a completed action.
