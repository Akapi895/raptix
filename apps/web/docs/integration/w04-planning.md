# W04 planning gate — 2026-10-02

## Contract and ownership

- `GET /api/engagements/:id/plan-docs` returns `PlanningView` version1, scoped
  engagementId, four typed public document projections, nine file validation
  statuses, and planning readiness reasons. `GET /:id/opplan` returns the same
  discriminated OPPLAN document. Reads set `Cache-Control: no-store`.
- Resolve owner through the server identity/repository before filesystem access.
  Stored slug policy is retained; stored workspacePath is never read authority.
  Only the nine fixed filenames under the trusted root/slug/plan are read.
- Reject child symlinks/junctions, including links into another project inside the
  root. Reject non-regular files; cap each file at1MiB, including growth while read.
  Missing files report missing; JSON/schema failures report invalid; inaccessible
  root/files and rejected links report unavailable. No reads create files.
- Public content allowlists exclude unknown fields, persistence metadata and the
  deconfliction shared secret. The five expansion documents expose status only.
  Browser validates both the typed response and its exact engagementId.
- The real Charter/Scope uses the source card/table typography, colors and shell.
  Targets/exclusions, testing windows, permitted/prohibited actions, CONOPS/threat
  assumptions, deconfliction markers and objective phases/status/dependencies come
  from the API. Read errors clear document content and expose refresh/retry.

## Runtime-source validation

`tools/generate-planning-schemas.py` exports the Pydantic models in
`packages/raptix-core/raptix_core/types/engagement.py` to the checked-in
`server/src/services/planning-schemas.json`. `--check` verifies source consistency.
The deployed Node API uses Ajv; it does not require Python or the legacy web.
Ajv is now a direct server dependency because this route consumes it directly.

JSON schema exports include list/dict default factories, including runtime RoE
prohibited actions. Defaults apply to the read snapshot only, never the source
files. Date-producing metadata factories are not synthesized. JSON primitive
types are validated without Pydantic coercion: malformed legacy primitive types
fail closed as invalid rather than being coerced into a ready bundle.

Readiness mirrors `tools/interaction/complete_planning.py`'s eight-document
requirements: RoE, CONOPS, Deconfliction, Threat Profile, Contact, Data Handling,
Abort and Cleanup. All validate, share one non-empty trimmed engagement name,
contain an explicit RoE authorization reference, and include the exact persisted
target in RoE scope. Persisted authorization and reviewed project metadata must
also be valid. OPPLAN is separately visible and is not a handoff prerequisite.
The result is document readiness, not proof of a runtime event or run submission:
`runtimeSignal` remains `not_observed`.

## Executed verification

From the repository root:

```powershell
$env:PYTHONPATH='D:\.VTNet\redteam\raptix\packages\raptix-core'
python clients/web-raptix/tools/generate-planning-schemas.py --check
npm run test --workspace=@raptix/web-contracts
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix
npm run build --workspace=@raptix/web-raptix
npm run test --workspace=@raptix/web-raptix
node clients/web-raptix/tools/verify-w01-independence.mjs --w04
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\tuanp\AppData\Local\Temp\opencode\pw-browsers'
npm run test:e2e --workspace=@raptix/web-raptix
```

Results: contracts28, server120, frontend54, mock production-browser8 passing;
server lint clean, frontend lint0 errors/38 inherited source warnings. The clean
independence install omits clients/web and regenerates the owned Prisma client;
all8 recorded commands exit0 (`w04-independence.json`). Initial npm registry reset
was resolved by a fresh `npm ci --prefer-offline` lane, retaining lockfile checks.

Live lane from `clients/web-raptix`:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\tuanp\AppData\Local\Temp\opencode\pw-browsers'
$env:W04_TEST_WORKSPACE='C:\Users\tuanp\AppData\Local\Temp\opencode\raptix-w04-20261002'
# W04_TEST_DATABASE_URL is supplied using the dedicated w02_test_20261001 role,
# PostgreSQL5433, database raptix_web_w02_fresh_20261001.
npx playwright test --config playwright.planning.config.ts
```

The config starts the compiled new server5281 and real-mode Vite5277 and stops
those owned processes afterwards. One comprehensive scenario passed on the final
tree: HTTP create201, missing/partial/full bundle, Scope targets/exclusions/windows,
OPPLAN status/dependencies, malformed RoE, unavailable file, refresh/reload,
project switching, same-root cross-project junction, secret redaction, write404,
outage503, wrong engagement response rejection,13nav,390px mobile width.
Screenshot: `test-results-planning/real-planning-live-new-API-d2e55-eload-scope-and-no-fallback/w04-real-planning-mobile.png`.

Source-emitter/runtime execution was not invoked by this gate. API runs against
the dedicated test DB and temporary files, not the production workspace. No DB
migration or scope write contract was added. Production same-origin deployment
verification remains part of the deployment phase.
