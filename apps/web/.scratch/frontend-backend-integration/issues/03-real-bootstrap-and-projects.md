# 03: Connect real bootstrap and engagement selection

**What to build:** A user selects real mode, sees actual server readiness and
identity, and creates/selects an engagement through the new project UI.

**Blocked by:** 02 (frontend cutover and packaging).
**Status:** in-progress (reopened by precommit verification, 2026-10-14)
**Requirements:** R02-R05, R06, R09, R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

Follow-up: [regression fixes and live flow](../regression-fixes-and-live-flow.md)
fixes response-body cancellation and verifies strict real-mode browser routing.
The own-flow regression gate passes; ticket closure still follows prerequisites.

The [precommit review](../verification-01-06.md) supersedes the completion
claim: response-body cancellation is swallowed by the transport; an abort
becomes an `internal_error` instead of preserving cancellation. The regression
is reproduced in `src/real/precommit-regressions.test.tsx`.

- [x] Bootstrap an explicit mock or real provider before any data read. Real mode
  obtains trusted identity/deployment information and actual capabilities; no
  persona override, seed authority or demo timer grants real permission.
- [x] Project list/create/select/detail use the engagement contract with server
  IDs and explicit workspace/display-name mapping. Wizard fields not yet
  supported have the treatment approved in 01, not fabricated persistence.
- [x] Project switcher and identity/project read seams use API-backed state;
  Query keys and invalidation include mode, identity and engagement. Dispose old
  reads/subscriptions and prevent stale project visibility after a switch.
- [x] A supported project write survives refresh. A missing API, invalid response,
  configuration failure or ownership denial has an actionable error and no mock
  fallback. Mock mode still works with the server absent.
- [x] Introduce only the shared transport/contracts needed for this first flow;
  real consumers cannot reach mock-only authority/clock/reset operations.

## Implementation notes

- Composition: `src/App.tsx` branches on the module-constant `DATA_MODE`
  (`src/real/mode.ts`, resolution precedence `?dataMode=` > localStorage
  `raptix.dataMode` > `VITE_DATA_MODE` > mock; switch = persist + full reload so
  every provider/cache/subscription is disposed with the old mode — ADR-0068).
- Real tree: `src/real/bootstrap.tsx` (capabilities document gates all children;
  BootError offers retry + explicit switch to demo, never an automatic fallback),
  `src/real/transport.ts` (single same-origin `/api` fetch, envelope unwrap for
  the server's `{statusCode,error:{code,message}}` shape, timeout/network mapped
  to explicit `unavailable` — never an empty result), `src/real/api.ts` (typed
  engagement adapters + `engagementToProject` mapping with explicit neutral
  values for API-absent fields), `src/real/queries.ts` (identity-scoped keys),
  `src/real/identity.ts` (leaf constants: trusted local operator, D1).
- Screens: `src/real/screens/portfolio.tsx`, `create.tsx` (only contract fields;
  server slug rule surfaced inline; unsupported wizard steps named not-yet
  integrated), `detail.tsx` (server id / display name / workspace slug rendered
  explicitly; unintegrated tabs render the honest unavailable panel).
- Seam: `src/state/console.ts` hooks are mode-aware (real: `useMe` = trusted
  operator, `usePolicyProjects` = mapped engagement list, `useDb` throws — fail
  fast for unintegrated surfaces); `useServices` throws in real mode so real
  consumers cannot reach mock-only authority/clock/reset; `useServicesOrNull`
  keeps the composition root tolerant. Shell mounts real header/ribbon/copilot
  stubs (`src/real/shell-parts.tsx`) instead of demo surfaces; host gates routes
  through `REAL_INTEGRATED_ROUTES` (`src/real/not-integrated.tsx`).
- UI `ProjectStatus` extended additively with `planning/running/completed/failed`
  (raw lifecycle passthrough, never relabelled into demo statuses).
- Harness fix from cutover retained: jest-dom matchers are registered app-locally
  in `src/test/setup.ts` (hoisted-vitest instance issue).

## Verification (2026-10-14)

- `src/real` suites: 38/38 across 6 files (mode precedence, transport envelope/
  failure mapping, adapter validation + mapping, bootstrap gating + boot error,
  route gating, screens, real-mode console seam).
- Targeted mock regression (shell/state/router — the composition seams touched):
  110/110. Single-writer closure test updated with the documented mode-switch
  reload exception (`src/real/mode.ts` full app reload, not an in-app route
  write).
- Typecheck, lint, production build clean for `@raptix/web-raptix`.
- Live smoke (Docker/Postgres running locally): server built + `prisma migrate
  deploy` OK; API (5280) + Vite dev (5273) started as tracked PIDs; through the
  dev proxy: `GET /api/capabilities` → mode `local-single-user`, projects
  supported+available; `GET /api/engagements` → `[]` (364ms); `POST
  /api/engagements` → engagement `cmv89jwc80000hkfivnrbmc1l` (draft,
  workspace `smoke-ticket03-check`); `GET /api/engagements/<id>` read-back OK —
  write persisted in Postgres. Both processes stopped by PID (verified gone).
- Named gap: the live 404-envelope probe was not exercised over HTTP (PS 5.1
  lacks `-SkipHttpErrorCheck`); 404/error envelope behavior is covered by the
  transport unit tests against the captured API fixtures. Browser-level
  point-and-click smoke not run (no browser automation in this environment);
  select/detail paths are covered by the real-screen component tests, which
  exercise the same server reads a refresh performs.

## Scope boundary

Full membership/RBAC is owned by 07. Workflow extensions such as ROE revisions
and closure are not made successful by generic engagement CRUD.
