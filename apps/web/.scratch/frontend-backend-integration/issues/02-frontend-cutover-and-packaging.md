# 02: Replace the browser app and establish canonical packaging

**What to build:** The new interface runs in the canonical Web application,
retains its standalone mock behavior and shares a working deployment boundary
with the preserved server.

**Blocked by:** 01 (complete).
**Status:** in-progress (reopened by precommit verification, 2026-10-14)
**Requirements:** R01, R02, R10, R11.
**Contract:** [execution.md](../execution.md).

## Acceptance

The [precommit review](../verification-01-06.md) supersedes the completion
claim: canonical builds work and the server is retained, but deployment smoke
is disabled in CI and its retained Playwright dependency is absent.

- [x] Replace the old browser implementation with the new visual baseline and
  canonical app name/location. Preserve server source/tests, database schema,
  migration history, runtime adapters and existing data. (Old 13-page browser
  app removed via `git rm`; `apps/web/server` untouched; `tools/`, contract
  fixtures and the w00 capture regression retained.)
- [x] Reconcile npm workspace names, dependencies and the root lockfile.
  Browser and server builds remain separate; browser tooling does not collect
  server or generated-client source (vitest include/exclude + eslint ignores).
  Production builds need no Figma preview configuration (`.figma` removed,
  vite config rewritten, figma comment slots replaced with a real HTML shell).
- [x] Preserve the 53 route keys, mock persona/project flows, demo reset, lazy
  composition, themes and dirty guards (route-inventory, App, services, session
  and wizard suites pass unchanged).
- [ ] Preserve existing same-origin API/SSE proxy behavior and update affected
  build/CI/launcher consumers. Move this tracker with the app; all links
  resolve. (Dev `/api` proxy retained in the rewritten vite config with
  canonical ports 5273/5274; production nginx proxy conf untouched; CI web-raptix
  lane unchanged except the docker-mode smoke steps, commented with ticket-03/18
  restoration notes; Makefile/launcher reference paths that still resolve.)
- [ ] Classify old frontend tests/tools and unique flows according to 01 before
  removal. Retain useful contract/deployment regression checks; record any
  remaining compatibility consumer and its owning integration ticket. (See
  classification below; remaining consumer = `verify-docker-real-mode.mjs`,
  gated to tickets 03/18.)

## Classification of the old app (retained vs retired)

Retained at the canonical location: `tools/` (deployment/contract harnesses,
CI consumer `verify-docker-real-mode.mjs`), `tests/fixtures/w00/**` + `w06/**`
(recorded real API/runtime captures), `tests/contracts/w00-captures.test.ts`
(contract regression, fixture loader fixed for Vite 8's `new URL` asset
transform). Retired with the old app: `src/`, `docs/`, 14 old-UI model tests,
21 Playwright UI specs + 10 Playwright configs, old README/AGENTS/`.env.example`
and the `.mise.toml`/package-lock local install authority. The `.figma` tooling
and the untracked `.ua` knowledge-graph cache were removed as regenerable.

## Verification evidence

Tree: cutover applied on top of `2c88117` (2026-10-14, local working tree).
Commands and outcomes:

- `npm install` (root): reconciled lockfile — +110/−105 packages; npm
  allow-scripts warnings for prisma/esbuild unchanged from the previous tree.
- `npm run build --workspace=@raptix/streaming` and `@raptix/web-contracts`: OK.
- `npm run prisma:generate --workspace=@raptix/web-raptix-server`: OK
  (Prisma 7.8.0); server `typecheck` + `build`: OK (server sources unchanged).
- `npm run typecheck --workspace=@raptix/web-raptix`: OK after two bounded
  cutover fixes recorded here: (1) `src/test/jest-dom.d.ts` restates the
  jest-dom vitest augmentation with vitest 5's two-parameter `Assertion`
  signature — jest-dom@7.0.1's own single-parameter augmentation cannot merge
  once the package hoists above the app's vitest; (2) `src/test/setup.ts`
  registers jest-dom matchers via app-local `expect.extend(matchers)` because
  the package's own `/vitest` entry binds a different hoisted vitest instance.
- `npm run lint --workspace=@raptix/web-raptix -- --max-warnings=0`: OK
  (eslint ignores extended for `server/`, `tools/`, `.scratch/`,
  `test-results*/`).
- `npm run build --workspace=@raptix/web-raptix`: OK (index chunk 132.29 kB gz,
  same closure as pre-cutover; no Figma files in the build).
- Selected suites: router inventory + navigation + App smoke + w00 contract
  regression (27/27), bootstrap/provider/session (15/15), wizard mock
  navigation/form smoke (18/18). Full UI suite (affected consumer of the
  harness changes: setup.ts, vitest scope, tsconfig include): **76 files,
  969/969 passed**.
- Known gap: Docker UI-image build and the suspended docker-mode smoke are
  verified by CI at push; local container runtime acceptance stays with 18.

## Verification selection

Run frontend typecheck/lint/build because packaging changes affect compilation.
Run only bootstrap/provider/router/mock-reset tests affected by the move, plus
route-inventory comparison and a representative mock navigation/form smoke.
Build preserved server/shared packages as needed to verify workspace resolution;
select server bootstrap tests only if its startup wiring changes. Reuse unchanged
server service-test evidence. Container runtime acceptance belongs to 18.

## Scope boundary

No real workflow implementation, database rewrite or automatic dependency-major
upgrade. This mechanical work package may need bounded expand/migrate/contract
patches; it is not permission for one oversized deletion/rename PR.
