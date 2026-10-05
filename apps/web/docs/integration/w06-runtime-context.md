# W06 trusted runtime context — 2026-10-02

## Server-owned authority

`server/src/services/runtime/runtime-context.ts` resolves owner/project identity,
persisted target/auth, planning document readiness, reachable assistant selection
and API/runtime workspace mapping. Caller input is restricted to kind and optional
assistant/thread selection. Arbitrary configurable, workspace_path, authorization,
sandbox_url, kg_engagement, language and model_override are not client authority.

Trusted `configurable` matches the CLI submit path:

```text
engagement_name            validated persisted workspace slug (not display title)
workspace_path             resolved runtime-visible POSIX path
target_type / target_value  persisted validated target
authorization_confirmed    persisted boolean, never inferred from a folder
language / sandbox_url     optional server configuration only
```

These fields are configuration, not message input. KG partition defaults to the
runtime's engagement slug; a non-empty hydrated foreign partition is rejected.
No per-browser partition resolver or runtime guard changes were introduced.

## Explicit topology configuration

Runtime integration is optional and requires `LANGGRAPH_API_URL` plus an explicit
canonical `RAPTIX_RUNTIME_WORKSPACE_ROOT`; no host Windows path is used as a runtime
path. URL credentials/query/fragment, non-HTTP(S) URLs and unsafe roots are rejected
without echoing values. Configuration is documented in `server/.env.example`.

- Tree mount: `/workspace` + project slug → `/workspace/<slug>`.
- Single-engagement mount: set `RAPTIX_RUNTIME_WORKSPACE_SLUG`; only that project
  resolves, at the configured root itself.
- API-side root still resolves the project folder by validated slug and rejects
  child junctions/symlinks, including links to another project inside the root.
- Optional `RAPTIX_RUNTIME_LANGUAGE`, `RAPTIX_RUNTIME_SANDBOX_URL` and
  `RAPTIX_RUNTIME_ASSISTANTS` are server-owned. Defaults allow Soundwave, Decepticon,
  Raptix and Vulnresearch only when actually returned by discovery.

Observed live topology: both LangGraph and sandbox mount the repository's
`workspace` directory at `/workspace`. The gate compared host/runtime hashes of a
new fixture's RoE file to verify this mapping rather than assuming it from paths.

## Selection and existing-thread checks

Discovery requires successful `/info` and paged `/assistants/search`. The adapter
has a body-inclusive5s deadline,2MiB JSON limit, bounded pagination, redirect refusal
and sanitized unavailable errors. It never returns a static catalog on failure.

Planning selects Soundwave. Default execution chooses a reachable allowlisted
Decepticon, then a registered Raptix alias. Explicit selection requires an actual
catalog match. Existing binding preserves its exact assistant; assistant/kind
changes conflict rather than silently switching graphs in a hydrated thread.

Additive migration `20261002010000_runtime_context_proof` adds nullable
EngagementThread.runtimeConfigHash. New trusted bindings persist a fingerprint of
engagement/assistant/kind/full configurable, including topology and optional server
settings. Existing null-proof bindings are not upgraded or adopted automatically.

Reuse requires:

1. Owner/project binding and unchanged W05 persisted identity/target/auth context.
2. Matching immutable full runtimeConfigHash.
3. Remote metadata engagement_id, workspace_slug, ui_assistant_id, graph_id, ui_flow
   and runtime_context_hash matching the trusted snapshot.
4. Hydrated checkpoint graph identity and all core configurable values matching.
   Partial hydrated context is rejected. Empty fresh state is allowed only with
   the full persisted/remote metadata proof.
5. No non-empty conflicting language, sandbox or KG partition.

Runtime reserved `assistant_id` is filtered from custom thread metadata. The new
contract deliberately uses `ui_assistant_id` for the server binding's logical
graph identity. Actual checkpoint defaults include empty language/kg_engagement;
these are unset values, not foreign contexts. Configured language must still match
the hydrated value. No mismatch is repaired by forcing new config onto old state.

## Public reads and readiness

- `GET /api/agents`: reachable allowlisted graph IDs, source=runtime.
- `GET /api/engagements/:id/runtime-context?kind=planning|execution` with optional
  assistantId/threadId: sanitized RuntimeContextView, `Cache-Control:no-store`.
- The public view omits configurable paths, hashes, remote metadata and secrets.
  Unauthorized project404, privileged selection400, mismatch409, unavailable503.
- Agents capability reflects live discovery. Dependency readiness is200 only when
  database and runtime probes succeed; run/thread-creation capabilities remain
  unsupported until their phase is implemented.
- `executionReady` is the reviewed metadata/document gate, not a runtime handoff or
  completed planning-run signal. Run service must separately enforce active-run and
  handoff policy. OPPLAN is not required for initial orchestrator planning.

## Executed verification

```powershell
node clients/web-raptix/tools/capture-w06-parity.mjs
npm run build --workspace=@raptix/web-contracts
npm run prisma:generate --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-contracts
npm run typecheck --workspace=@raptix/web-contracts
node clients/web-raptix/tools/verify-w05.mjs fresh --w06
node clients/web-raptix/tools/verify-w05.mjs oldcopy --w06
node clients/web-raptix/tools/verify-w06-live.mjs
node clients/web-raptix/tools/verify-w01-independence.mjs --w06
```

The CLI producer fixture comes from executing the extracted real TypeScript submit
block, not hand-authored expected values. The installed runtime's actual hydration
helper was called with that config and verified to preserve existing foreign state.
Unit replay checks the CLI source-block hash and the producer/consumer outputs.

Live gate uses dedicated fresh PostgreSQL, compiled new API5283, actual runtime2400,
and a unique owned engagement workspace. It executes installed hydration logic,
creates a remote thread fixture, persists its resulting values via checkpoint update
and verifies the context through the new API. Real remote metadata/target changes,
missing persisted proof, owner and kind mismatch, forbidden browser override and
unreachable runtime all fail closed. Both discovery and checkpoint source shapes
were captured. The first live reserved-key/default-field assumptions failed and
were fixed only after capture plus a failing regression.

This gate did not create a graph run or invoke a model/tool. It proves live context,
mount, thread/checkpoint and middleware-helper parity; assessment execution and
runtime-state reconciliation remain W07+ scope. The fixture remote thread was
deleted only after verifying its unique ownership marker; its workspace and the
owned API process were also removed/stopped. Production data was not migrated.

Results:

- Server135 tests, shared contracts32 tests; server lint/typecheck/build pass.
- Fresh/oldcopy additive migration preserves existing engagement-row fingerprints
  and all4 prior migration checksums. W05's8 PostgreSQL assertion groups and actual
  API-process restart proof pass per lane; separate W06 evidence files preserve the
  earlier W05 records.
- Clean npm ci/own Prisma generation/server135 tests/server+frontend builds pass
  with clients/web omitted (`w06-independence.json`).
- Frontend typecheck/lint/build/54 tests pass; lint0 errors/38 inherited warnings.
- Mock production-browser8/8 and W04 live planning-browser1/1 pass.

Evidence: w06-live.json, w06-migration-{fresh,oldcopy}.json, w06-independence.json,
tests/fixtures/w06/{cli-context,runtime-thread}.json. No staging or commit occurred.
