# Regression fixes and real runtime flow

Date: 2026-10-14 UTC. Base HEAD: `2c8811799b8bc58530f80ee6e32787bc365a2006`.
Tested tree: uncommitted Web integration plus these fixes. No commit/push/index
rewrite. Server/shared-contract source and unrelated user work were not edited.

## Verdict and fixes

All **13 original acceptance regressions pass**. The expanded acceptance file
adds route restoration, lost-ACK remount/reconcile and late-ACK scope coverage
(16 tests); a separate real-App StrictMode regression also passes.

- Transport preserves body-read cancellation/timeouts instead of swallowing them.
- Adapters validate run entries, record/scope/request IDs, command operations,
  nested ownership and artifact paths. Thread ID participates in context keys.
- SSE checks scope, deduplicates event IDs and ignores disposed/old callbacks.
  Checkpoint provenance stays thread history; disconnects surface recovery.
- Blocked planning disables handoff; empty truncated findings retain warning.
- Scoped selection/request identities persist before POST, without command bodies.
  Lost ACK preserves identity/draft; remount Reconcile sends no additional run POST.
- Owned run reads restore observation. Terminal states match the server's
  success/error/timeout/interrupted. Late ACKs cannot install runs in another scope.
- Execution requires thread-verified context matching its bound assistant/snapshot.
  Parallel questions submit one complete batch; single-question shape is retained.
- Browser testing also exposed late-bootstrap routing and StrictMode cleanup
  leaving the active router null. Initial route sync/layout-effect republication
  repair both. Fixtures with wrong returned IDs/blocked handoff were corrected;
  guards were not relaxed to accommodate them.

## Targeted verification

```powershell
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=2 src/real src/router src/shell src/state src/App.test.tsx tests/contracts/w00-captures.test.ts
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=2 src/real/app-routing.real.test.tsx src/real/precommit-regressions.test.tsx
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=2 src/real/planning-api.test.ts src/real/screens/workspace.test.tsx src/real/precommit-regressions.test.tsx
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix -- --max-warnings=0
npm run build --workspace=@raptix/web-raptix
node --check apps/web/tools/verify-integration-live.mjs
```

Observed: broader affected selection **27 files / 171 pass**; focused real-App
and acceptance **17/17 pass**. After final ACK-operation/assistant tightening,
affected consumers reran **30/30 pass**. Counts overlap, not summed. Final
typecheck/lint/build/syntax passed; no full suite. Server evidence remains valid
because its source was unchanged.

## Real runtime flow

The source harness `apps/web/tools/verify-integration-live.mjs` launches dedicated
DB/workspace volume, hardened sandbox, actual LangGraph and current compiled API.
Existing user engagement files are not mounted. Playwright 1.64.1/Chromium were
installed only in pre-approved temporary tools, without manifest/lock changes.
Vite is resolved from the Web workspace (8), not root-hoisted Vite (7).

```powershell
docker start raptix-litellm
docker build -f infra/containers/web-raptix-server.Dockerfile -t raptix-web-verification-api:20261014 .
node apps/web/tools/verify-integration-live.mjs --start
$env:RAPTIX_VERIFICATION_TOOLS='C:\Users\tuanp\AppData\Local\Temp\opencode'
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\tuanp\AppData\Local\Temp\opencode\browsers'
node apps/web/tools/verify-integration-live.mjs --flow tests/local/artifacts/integration-live/a0639bcf/state.json
```

Actual browser actions, same-origin proxy, real models/runtime/filesystem tools:

| Step | Identity / observed result |
|---|---|
| Engagement | `cmv8ciemj000037pl459ksp60`, slug `web-acceptance-a0639bcf` |
| Soundwave thread | `23d2ef77-9a81-41ce-8703-dd40d4e5f67c` |
| Planning run | `01a13b59-f2a7-7f60-9ed9-fbb3d180a5c6` |
| Checkpoint question | `chatcmpl-tool-9b186b9e2116d393`, interrupt ID present; same question restored after refresh |
| Planning resume | `01a13b5a-d914-7893-8e6e-8241d7bfc64c`; model/tools generated eight valid documents, readiness ready |
| Handoff | Browser PATCH persisted after readiness |
| Execution thread | `f0ed14d3-efc2-4035-8c69-326ef746f33c`, assistant decepticon |
| Execution request | `3f163baa-a279-46e0-acc5-212ef61f8ae1` |
| Execution run | `01a13b5d-cc13-7bc3-afed-c14985741b5e`, authoritative success |
| Output | Agent wrote/read `findings/FIND-WEB-ACCEPTANCE.md`; informational, defaultSeverity false, marker `WEB_ACCEPTANCE_a0639bcf` |
| Restore | One native execution run for that request; refresh dispatched no duplicate |
| SSE | Actual native late replay: valid scoped events/control frame; checkpoint runId:null retained |
| UI | Findings tab and artifact inspector displayed actual runtime-generated content |
| Failure paths | Traversal 400, missing artifact 404, wrong engagement/thread 404 |
| Timeline | Actual mixed-source projection retained runtime/checkpoint/workspace labels |

The output is a **local pipeline marker, not a vulnerability**. No target was
contacted. The harness did not seed documents/findings or mock model/API behavior.
Runtime image: ghcr.io/akapi895/raptix-langgraph:stable, image ID
`sha256:3f5d243965e8f43d69e2890957c67d0938ed0cf2f5529f8097d4b52add4f92af`.
This is not a claim that pending user's Python changes were rebuilt/tested.

Attempts are retained honestly: wrong CLI first, then routing bugs; an initial
execution POST returned 409 and was treated as rejection. The later acknowledged
request completed. Title matching was corrected to the actual API title (agent
prefixed the finding ID). Harness continuation reused completed work.

## Evidence and cleanup

Ignored local evidence: `tests/local/artifacts/integration-live/a0639bcf/` contains
state.json, observed-output.json (owned snapshots/content/timeline/native run
identities/SSE provenance), produced-findings.png and failed-attempt diagnostics.
This summary and harness are durable source files.

Each labelled container was removed in a separate command with a hard 5-second
tool timeout; all three succeeded:

```powershell
node apps/web/tools/verify-integration-live.mjs --stop tests/local/artifacts/integration-live/a0639bcf/state.json raptix-web-acceptance-a0639bcf-api
node apps/web/tools/verify-integration-live.mjs --stop tests/local/artifacts/integration-live/a0639bcf/state.json raptix-web-acceptance-a0639bcf-runtime
node apps/web/tools/verify-integration-live.mjs --stop tests/local/artifacts/integration-live/a0639bcf/state.json raptix-web-acceptance-a0639bcf-sandbox
```

DB `raptix_web_acceptance_a0639bcf` and volume `raptix-web-acceptance-a0639bcf`
remain as evidence. Shared LiteLLM was started for testing and left healthy;
existing user containers/volumes were retained. No blanket process cleanup.

The regression and first-flow blockers are resolved. Schema design (01), suspended
deployment CI smoke (02) and remaining live HITL/cancel acceptance (05) are separate
requirements; this report does not declare all tickets/deployment parity complete.
