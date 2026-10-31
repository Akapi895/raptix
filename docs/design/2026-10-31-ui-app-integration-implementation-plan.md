# UI-app integration implementation plan

Status: **living document** — update it as modules land, don't let it drift the way the old `apps/web` integration tracker did. Decided by ADR-0106 (`docs/adr/0106-retire-apps-web-for-ui-app-and-api.md`); read that first for *why*. This document is *how* and *in what order*.

Goal: every one of `apps/ui-app`'s 300 documented operations
(`apps/ui-app/docs/openapi.yaml`, `apps/ui-app/docs/api-contracts.md`) either
has a working `apps/api` route backed by the real Raptix runtime, or has an
explicit, recorded decision to stub or cut it. "It compiles" is not done;
"an operator can run a real engagement through `apps/ui-app` end to end" is
done.

## 0. What exists today (2026-10-31)

- `apps/ui-app`: imported, uncommitted-until-now frontend, zero backend wiring. Its own demo/mock transport (`src/mock/`) is dev-only, never a stand-in for `apps/api`.
- `apps/api`: skeleton only — `src/app.ts`, `src/main.ts`, one `GET /api/health` route. Builds, typechecks, serves. No auth, no DB, no runtime adapter, no domain routes.
- `apps/web` and its Fastify/Prisma server: deleted (commit `d31af85b`/`54cc115e`, see `git log --all --diff-filter=D -- apps/web` for the exact SHA to recover anything from). Its Prisma schema modeled: `AssetIdentity`, `BusinessPlan`, `C2Command`, `C2Grant`, `Campaign`, `CampaignJob`, `DeploymentSlot`, `EmergencyStop`, `Engagement`, `EngagementClosure`, `EngagementThread`, `EnvironmentCommand`, `EvidenceLink`, `FindingComment`, `FindingHistory`, `FindingRecord`, `FindingRetest`, `FindingSuggestionDisposition`, `LibraryProposalReview`, `LibraryReviewProposal`, `OperationBinding`, `OperationSchedule`, `PlanDocumentDraft`, `ProjectEnvironment`, `ReportAcknowledgement`, `ReportDelivery`, `ReportFindingSnapshot`, `ReportRecord`, `ReportTemplate`, `RetainedCapture`, `ScopeRevision`, `ThreadMigrationRecord`, `VaultAudit`, `VaultSecret`, `WebAsset`, `WebAuditEntry`, `WebMembership`, `WebNotice`, `WebRequestLedger`, `WebSession`, `WebShellAcquisition`, `WebShellCommand`, `WebShellConnection`, `WebShellProbe`, `WebUser`, `WorkspaceSetting` — useful as a reference for what business-record shape worked, not a schema to copy onto `apps/ui-app`'s contract as-is (different DTOs).
- Its infra integrations (recoverable the same way): `src/integrations/{c2,campaigns,environments,sandboxes,webshell}`, `src/db/client.ts`.

## 1. Architecture recap

```
apps/ui-app (browser)
   -> apps/api  (BFF; holds RAPTIX_RUNTIME_API_TOKEN_FILE; Prisma for records with no runtime equivalent)
        -> packages/raptix/raptix/interfaces/api/*  (LangGraph HTTP API: /threads /assistants /runs + custom mounts)
        -> infra integrations (C2 / sandboxes / webshell / environments / campaigns)
        -> Neo4j (AKG), Postgres (apps/api's own Prisma DB)
```

`apps/api` never lets `apps/ui-app` see a runtime thread/run ID shape unless the contract already expects one (some do — the chat/agent-loop module is close to 1:1 with LangGraph's `/runs` semantics; projects/RBAC are not).

## 2. Module map: ui-app contract -> Raptix runtime concept

Ordered by the priority tiers in §3, not by the module index's own order. "Runtime fit" is a quick read on whether a Raptix concept already does this, needs new design, or has nothing to map to.

| Module (ops) | Raptix concept | Runtime fit | Notes |
|---|---|---|---|
| Authentication and account (7) | single-operator mode (ADR-0100) | **done (Tier 1)** | `src/http/routes/auth.routes.ts`: login/logout/validate/change-password are real, Postgres-backed. `robot-binding-code`/`robot-bindings` (3 of the 7 ops) stubbed `501` -- they belong to the Robots-and-bindings cut candidate, not auth proper. |
| Dashboard, notifications and usage (5) | telemetry, token-usage middleware | partial | Token/usage data exists in runtime telemetry; notifications need a new sink. |
| Projects and fact graphs (18) | `orchestration/mission` (OPPLAN/`EngagementContext`) + `knowledge/graph` (Neo4j AKG) | good fit | Closest 1:1 mapping in the whole contract. Start here. |
| Agent chat and running tasks (8) | LangGraph `/runs`, `intelligence/agents` | good fit | Near-native; translate run/thread IDs and streaming event shapes. |
| Conversations and messages (13) | LangGraph `/threads`, checkpointer | good fit | Pairs with the above. |
| Human-in-the-loop (17) | HITL middleware (opt-in per root `CLAUDE.md`) | good fit | Raptix HITL is real; translate its decision schema to `apps/ui-app`'s. |
| Assets (11) | `knowledge/graph` asset-map, `WebAsset`-equivalent table | good fit | Reuse the asset identity model (ADR-0094) conceptually. |
| Attack chains (3) | `knowledge/graph` traversal views | good fit | |
| Vulnerabilities (12) | findings/evidence (`execution/tools/evidence`, `specialist_contracts`) | good fit | |
| Terminal (2) | sandbox exec, interactive PTY (ADR-0095, Proposed — confirm Accepted before relying on it) | good fit, one caveat | ADR-0095 must move to Accepted before this ships for real; don't build past it. |
| C2 (32) | salvaged `integrations/c2` + Sliver C2 (ADR-0006 opt-in specialist workload) | good fit, largest module | Biggest single chunk of work; slice by sub-area (grants, sessions, commands). |
| WebShell (10) | salvaged `integrations/webshell` | good fit | |
| Skills (12) | `raptix-skills` corpus + `raptix/skills` runtime loader | good fit | |
| Knowledge (12) | `knowledge/graph`, `knowledge/ingest` | good fit | |
| Recon / information collection (3) | `execution/tools/research`, `references` | good fit | |
| Tool guard (3) | RoE/budget middleware, `SafeCommand` | good fit, guard-rail-adjacent | Changes here fall under the "don't weaken guard rails without an ADR" rule even inside `apps/api`. |
| Configuration and AI models (12) | `intelligence/llm` model factory/provider router, LiteLLM proxy | good fit | |
| External MCP servers (8) | `interfaces/mcp` | good fit | |
| MCP monitor and execution details (13) | `interfaces/mcp`, `execution/session` event log | good fit | |
| Batch task queues (15) | salvaged `integrations/campaigns` | good fit | |
| Workflows and packages (18) | no direct equivalent — closest is skills/OPPLAN objectives | **needs design** | Largest "needs design" module; don't guess the shape, write a short note in this doc's §6 before starting. |
| Platform access / RBAC (14) | none (Raptix has agent/specialist roles, not user RBAC) | **no runtime equivalent** | New `apps/api`-local schema, modeled loosely on the retired `WebMembership`/`WebUser`. |
| AI roles (5) | none at the user-role level (agent specialist roles are a different concept) | **no runtime equivalent** | Same bucket as RBAC above; don't conflate with `intelligence/agents` specialist roles. |
| Audit (6) | `execution/session` event log, or a new `apps/api` audit table | partial | |
| Files and chat uploads (12) | project sandbox filesystem (ADR-0102: project files only through the project sandbox) | good fit, one hard rule | Must go through the sandbox per ADR-0102 — never a direct host path. |
| Storage (3) | same as above | good fit | |
| Markdown agents (5) | `intelligence/prompts` (Markdown prompt assembly) | unclear — **confirm before building** | May be CyberStrikeAI's own "custom agent via Markdown file" feature, which Raptix's prompt system wasn't built for end users to author. Spike before committing a route shape. |
| Robots and bindings (10) | none found | **cut candidate** | Looks like messaging-platform bot bindings (`apps/ui-app/src/features/wechat-robot/`). No Raptix concept. Recommend cutting the feature from `apps/ui-app` rather than building a fake backend for it — bring to the repo owner as an explicit accept/cut decision, don't cut unilaterally. |
| System updates (8) | none | **cut candidate** | Self-update checking (likely from CyberStrikeAI's own release channel). Raptix updates ship via the Go launcher, a different mechanism entirely. Same accept/cut process as above. |
| OpenAPI and miscellaneous (3) | `apps/ui-app`'s own `api-docs` feature | good fit | Serve `apps/ui-app/docs/openapi.yaml` (or `apps/api`'s own generated spec once routes exist) from `apps/api` directly. |

## 3. Priority tiers (sequencing)

Each tier is its own run of PRs, each PR one module (or one C2 sub-area), each respecting the ≤400 runtime lines / ≤10 files / one-concern budget in `CONTRIBUTING_AGENT.md`. Do not start a tier before the previous one's gates are green against a real `apps/ui-app` build (`VITE_MOCK` unset) — "typechecks" is not "works."

1. **Foundation** — auth/session stub (single-operator, ADR-0100-style), the runtime adapter (`src/adapters/runtime/`) with token handling, Prisma bootstrap in `src/db/`. Nothing here is user-visible yet; it's what every later tier needs.
2. **Core loop** — Projects, Agent chat/running tasks, Conversations/messages, Human-in-the-loop. This is the minimum for "an operator can start an engagement and talk to an agent through `apps/ui-app`."
3. **Findings** — Assets, Attack chains, Vulnerabilities, Files/uploads, Storage.
4. **Operations** — C2 (by sub-area), WebShell, Terminal (gate on ADR-0095 Accepted), Batch task queues.
5. **Knowledge & tooling** — Skills, Knowledge, Recon, Tool guard, Configuration/AI models, External MCP servers, MCP monitor.
6. **Platform** — RBAC, AI roles, Audit, Dashboard/notifications/usage, OpenAPI/misc.
7. **Decide, then build or cut** — Workflows/packages, Markdown agents, Robots and bindings, System updates. Each needs the repo owner's explicit accept/cut call (per §2) before any route work starts; don't default to "build everything."

## 4. Per-PR checklist (every module)

- Route file at `apps/api/src/http/routes/<module>.routes.ts`, named after the module's slug in `apps/ui-app/docs/api-contracts.md`.
- Request/response shapes come from `apps/ui-app/docs/openapi.yaml` for that module — not from guessing at `apps/ui-app`'s TypeScript types, which describe client-side construction, not a verified server contract (the gaps report says so explicitly).
- A route that has no Raptix-side data yet returns an explicit `501`-style "not implemented for this deployment" body, never a fabricated success — this is ADR-0106 decision 5.
- Test against the real `apps/ui-app` build (`npm run build --workspace=@raptix/ui-app`, then serve it against the real `apps/api`), not just `apps/api`'s own unit tests.
- Update the module's row in §2's table (fit confirmed, partial, or blocked) and the tier checklist below as it lands.

## 5. Tier progress checklist

- [x] Tier 1 — Foundation (2026-10-31): auth module (login/logout/validate/change-password) against a real Postgres-backed `Operator`/`Session` schema, single-operator first-boot seed, the LangGraph runtime adapter (`src/adapters/runtime/client.ts`, unit-tested; not yet wired to a route). `robot-binding-code`/`robot-bindings` stubbed `501` per §2/§7. Verified with a live end-to-end smoke test (real Postgres, real server, curl) in addition to the unit suite.
- [ ] Tier 2 — Core loop
- [ ] Tier 3 — Findings
- [ ] Tier 4 — Operations
- [ ] Tier 5 — Knowledge & tooling
- [ ] Tier 6 — Platform
- [ ] Tier 7 — Decide, then build or cut

## 6. Open design spikes (resolve before the tier that needs them)

- **Workflows and packages (18 ops).** No Raptix equivalent decided. Spike against OPPLAN objectives (`orchestration/mission`) vs. the skill engine (`raptix/skills/engine`) before Tier 7.
- **Markdown agents (5 ops).** Confirm with the repo owner whether this is end-user custom-agent authoring (no Raptix equivalent — Raptix specialist agents are code, not user-authored Markdown) before Tier 7.
- **RBAC/AI roles schema.** New `apps/api`-local Prisma schema. Model loosely on the retired `WebMembership`/`WebUser` (§0), but check it against `apps/ui-app`'s actual RBAC/`roles` contract shapes first — don't port the old schema verbatim.

## 7. Known breakage left behind by the ADR-0106 deletion (cleanup backlog, not blocking)

These import from or comment on the deleted `apps/web/server`. None of them run in CI or any Make target (verified), so they don't block Tier 1, but fix them when the module they touch is rebuilt:

- `scripts/asset-map/backfill_rehearsal.mjs`, `scripts/asset-map/measure_read_models.mjs` — import `/app/apps/web/server/dist/{db/client,services/graph-service,services/asset-map-service}.js` directly. Rewrite against `apps/api`'s equivalents once the Assets module (Tier 3) lands.
- `benchmarks/target-lab/httpd-2.4.49/bridge-compose.yml` — one stale comment referencing `apps/web/server/src/config/env.ts`. Cosmetic.
- `apps/shared/streaming/tests/normalize.test.ts` — a docstring comment pointing at a fixture path under the deleted `apps/web/tests/`. Cosmetic.
- `docs/architecture/container-view.md` ("`web` | `apps/web/` | Next.js dashboard") and `docs/architecture/dependency-rules.md` (`apps/web/tools/` allowlist entry) — both already described a retired Next.js lane before this change, i.e. they were stale before ADR-0106 too. Fix alongside a real architecture-doc pass, not as part of this migration.

## 8. Reintroducing CI/Make targets

Do not reintroduce a `webraptix-*`-shaped Make target family or CI job until Tier 2 is green — a quality gate for a backend with no working core loop just blocks every unrelated PR. When Tier 2 lands, add back: a `ui-app-quality` Make target (typecheck/lint/build/test for both `apps/ui-app` and `apps/api`), its `paths-filter` entry in `.github/workflows/ci.yml`, and its dependency in `quality`/`ci-ok`. Model the shape on the removed `webraptix-quality`/`web-raptix` job (recoverable from git history prior to commit `54cc115e`), not copied verbatim — the workspace names and directories have changed.
