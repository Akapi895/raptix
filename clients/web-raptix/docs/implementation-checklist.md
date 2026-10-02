# UI implementation coverage — 2026-10-01

> Historical delivery. The later user correction supersedes this UI scope: use
> `clients/web-correct`, exactly 13 workspace entries, frontend visualization only.
> Current coverage is in `correct-frontend-scope.md`; Members/Vault/Campaign/C2
> are active demo pages and the earlier Root Agent/Overview/Graphs/Evidence routes are retired.

Source: `summary/impl-plan-web-raptix.md`, all 23 sections reviewed by HEAD.
Scope of this delivery: single-user frontend UI and deterministic mock acceptance.
Backend/live execution/server migration gates are recorded separately below.

## P0/P1: baseline and standalone frontend

- [x] Existing screen/interaction inventory, backend gap map and single-user/canonical-screen decisions read and preserved.
- [x] Package `@raptix/web-raptix`, npm workspace, explicit typecheck/lint/build and Figma-independent config verified.
- [x] Local-first Inter/JetBrains Mono/system fallback: rendering has no required external font fetch.
- [x] Baseline HEAD commands passed: typecheck/lint/build; 54 lint warnings; initial JS bundle 630.97 kB.
- [x] Main screens lazy-loaded: current initial JS bundle 272.43 kB (83.19 kB gzip), build 304 ms in the follow-up verification run.
- [x] Current UI render evidence: 14 desktop views (1280×720), 4 mobile views (390×844), no browser runtime errors in the smoke flow.
- [ ] Clean root `npm ci`/Linux verification and original-Figma pixel parity are not claimed. `npm install` succeeded on the existing Windows workspace; no clean-checkout lane was executed.

## P2: shell, design system and responsibilities

- [x] Central navigation labels/groups; correct Root Agent/Graph labels and reachable supported screens.
- [x] Members/Vault/Campaign/C2 not mounted as active routes. Local operator identity replaces active member/role presentation.
- [x] Responsive sidebar/header/main; mobile drawer close, Escape, focus restore/trap and hidden-navigation inert state.
- [x] Mobile AgentRun sessions/agent drawers preserve full-width composer; fixed panel/header height issues corrected.
- [x] Shared Dialog for New Project/New Chat/HITL/Finding/Evidence with labels, Escape, focus trap/restore and bounded scrolling.
- [x] Shared disabled-capability button, keyboard focus styling, reduced-motion and table overflow helpers.
- [x] Run model/store/scenarios/inspector/message renderer extracted; planning/report/graph/finding/evidence fixtures separated.
- [x] Console public-action sample separated, no private-reasoning/OPSEC telemetry fabrication.
- [ ] Full relocation of every retained legacy screen into feature folders is not performed. Canonical entry paths are retained while feature responsibilities are extracted. Inline legacy sample assets/log archive remain candidates for follow-up structural cleanup; this does not enable real-mode fixtures.

## P3: implemented UI acceptance

- [x] URL project/thread/finding/evidence deep links, malformed/deferred Not Found, refresh and Back/Forward.
- [x] Project search/filter in query params; create and display-name settings persist in mock repository.
- [x] Slug/target/authorization validation and duplicate conflict errors; stable UUID identity; workspace slug immutable.
- [x] Scoped thread creation/select, per-thread composer drafts, bounded history and reload without resubmission.
- [x] Shared Chat/Console/Logs/Overview/HITL run source, project isolation and same-project counters.
- [x] Close approval only dismisses. Allow/deny acknowledgements scoped to the pending mock request, duplicate/stale decisions rejected.
- [x] Seeded/deterministic scenarios: new empty/planning projects, ready/active/HITL/completed/failed/connection-lost/reconnecting run controls, validation/conflict responses.
- [x] Connection lost is distinct from failed; transport scenario changes never resubmit a message.
- [x] Findings → detail → evidence cross-links and URL-close semantics; filters and text previews; binary preview unavailable with reason.
- [x] Acme sample archive scope enforced; other projects get empty/missing-document states, not borrowed outcomes.
- [x] Asset counts derive from the sample projection; graph selection/filter and observed-relationship semantics preserved; credential values redacted.
- [x] Actual report JSON/Markdown demo downloads; mock markers in filenames/payloads; unsupported formats do not silently fallback.
- [x] Unsupported scope writes, PoC execution, review persistence, integrations, AI compile/sign/share and destructive controls do not report fake success.
- [x] Explicit mock source labels. Real-mode guard displays unavailable and never substitutes demo data.

## Verification evidence

Working directory: `D:\.VTNet\redteam\raptix`; Node `v24.18.0`, npm `11.16.0`, Windows.

| Command | Result |
|---|---|
| `npm run typecheck --workspace=@raptix/web-raptix` | Pass; browser/tooling/tests configs |
| `npm run lint --workspace=@raptix/web-raptix` | Pass; 0 errors, 9 warnings in retained unmounted design references (54 at baseline) |
| `npm run build --workspace=@raptix/web-raptix` | Pass; static `dist/`, no Figma/backend requirement |
| `npm run test --workspace=@raptix/web-raptix` | 15 model tests pass |
| `npm run test:e2e --workspace=@raptix/web-raptix` | 13 browser flows pass against rebuilt production preview; follow-up run 20.5 seconds |
| `npm run test:e2e:real --workspace=@raptix/web-raptix` | 1 real-mode unavailable/no-fixture-fallback browser guard passes |

Browser installation used `PLAYWRIGHT_BROWSERS_PATH=C:\Users\tuanp\AppData\Local\Temp\opencode\pw-browsers`.
Screenshots/traces are in ignored `test-results/`; real-mode lane has separate `test-results-real/`.
The first regression runs caught lost seeded-thread history, stale approvals on reload,
malformed project recovery, invalid targets and a mobile drawer close obstruction;
these were fixed and the relevant cases passed after the fixes.

Independent reviews: responsive/a11y, state/routing, data consistency and a fresh narrow
coverage review. One broad reviewer produced abnormal output; it was discarded and
replaced. Concrete findings were fixed; current screenshot checks also corrected mobile
header crowding. Mock and real guard lanes have separate artifact folders to avoid
parallel-test cleanup races. ESLint excludes only generated test artifacts.

## P4–P7: not claimed as backend integration completion

Real adapters, representative backend payload verification, real project/planning
requests, scoped run submission/streaming/history/context guard parity, server-acked
HITL and real findings/artifact/graph/report data are not implemented/verified by this
UI delivery. Current `VITE_DATA_MODE=real` intentionally shows unavailable.

Reason: these are backend/runtime integration work packages after standalone frontend
acceptance. Proposed run APIs require scoped ownership/context/guard contracts and
runtime verification; fake mock success cannot satisfy these gates. Existing Next APIs
are inventoried in `api-mapping.md`, not presented as connected.

## P8/P9: deferred architecture/deployment work

New server framework/package, Prisma ownership/migrations and endpoint parity depend
on Milestone B. Containers/reverse proxy/SSE/WS/CI/launcher cutover and rollback depend
on those migration gates. They change backend/deployment architecture beyond this UI
delivery and are not marked complete from a frontend build. No launcher/runtime/data
cutover was performed. `clients/web` remains the existing backend source.

## Confirmed backlog (§1.4/§22)

Members/RBAC, Credentials Vault, Vector Campaigns, C2 commands, direct subagent
messaging, skill/MCP runtime mutation, finding review persistence, PDF/DOCX generation
and hosted multi-user deployment remain unavailable until corresponding contracts exist.

## Ensemble / repository integration

All spawned scouts/builders/reviewers/fixers used `vtnet/zai-org/GLM-5.3-Flash`.
The session root is outside the nested Git checkout and frontend source was untracked;
Ensemble could not isolate it in worktrees. Slices therefore used exclusive named
file ownership in the shared checkout. HEAD integrated, inspected key patches and
verified the composed application. No branch existed for `team_merge`; no user files
were staged/committed. Existing unrelated changes were preserved. Root lockfile changed
only through the npm install needed for the frontend test dependencies.

Initial delivery Ensemble board: 27/27 tasks completed; all teammates shut down. HEAD also ran
`git diff --check -- package-lock.json clients/web clients/web-raptix` successfully and
confirmed `clients/web` has no changes in this delivery. The frontend remains untracked
as it was at entry; no staging or repository commit was performed.

## Follow-up verification / user preview

HEAD reproduced two additional lifecycle regressions with failing tests: starting an
idle project did not mark the Root Agent running, and stopping an active run left
agent instances marked running (also after reload). The shared store now normalizes
agent status with run controls both on transitions and on recovery. Two model cases
and one production-browser Start/Stop/reload case were added and passed after the fix.

Latest verification: typecheck/build pass, lint 0 errors/9 retained-reference warnings,
15 model tests pass, 13 production-browser flows pass, real-mode guard 1/1 passes.
Desktop/mobile screenshots were inspected by HEAD. A local production preview was
started for user testing at `http://127.0.0.1:5284/projects` (launcher PID 14344).
Projects, `/projects/1/overview` and the current production JS bundle were checked
over HTTP and all returned 200. This preview serves mock UI only; backend P4–P9
integration remains unavailable.
