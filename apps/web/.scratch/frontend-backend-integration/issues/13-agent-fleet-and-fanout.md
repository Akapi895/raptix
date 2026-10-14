# 13: Integrate agent fleet and fanout control

**What to build:** Users inspect actual agent/worker inventory, health and branch
execution and perform only supported allocation/retry/reassign/cancel operations
with engagement-scoped outcomes.

**Blocked by:** 05 (execution, streaming and recovery).
**Status:** complete (fleet projection + recorded action exclusions; see Evidence)
**Requirements:** R03-R05, R07-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [x] Distinguish assistant graph catalog, subagent/worker invocation and deployed
  endpoint identity in fleet/detail and fanout/branch views. Source each field
  from the owning runtime/provider; missing heartbeat data is not fabricated.
  *(FleetService emits `sources: { agents: 'runtime-catalog', threads: 'runtime', branches: 'checkpoint' }`
  and the panel labels the catalog section "catalog identity only; no endpoint health".
  Catalog = `RuntimeContextService.agents()` (runtime catalog filtered by config);
  threads = bound runtime threads + raw thread status; branches = observed
  subagent_start/end pairing from checkpoint transcripts.)*
- [x] Timeline/dependency/worker-graph views use observed IDs and events with
  provenance. Replay cannot double-count branches or attribute history to a new
  run; scope switching drops old branch callbacks.
  *(Branches carry `provenance: 'checkpoint'` and thread-scoped keys; the underlying
  transcripts stay `runId: null` per the W09 contract (history-projection) and
  dedupe via the shared normalizer's identity key, so replays cannot double-count.
  React Query keys are per-engagement (`['real','fleet',engagementId]`), so scope
  switching cannot leak stale branch callbacks.)*
- [x] Required group/allocation/branch action APIs are implemented against real
  runtime semantics or explicitly excluded by 01. Retries and cancellation retain
  stable identity, authorization, concurrency and uncertain outcome handling.
  *(Run-level cancel is implemented with stable identity and re-read semantics
  (ticket 05, reused unchanged). Branch retry/reassign/branch cancel and agent
  allocation/grouping have NO runtime action contract — recorded as excluded via
  `excludedActions` in the API response and surfaced as a D1/D2 banner in the panel;
  D2 forbids a new business store for them.)*
- [x] Branch completion/failure/unknown statuses and reassignment are server-
  authoritative. No frontend timer changes a worker to online or completed.
  *(Branch state/outcome are computed server-side by `projectFleetBranches` from
  checkpoint events (`failed`/`cancelled`/status/`completed`); the panel only renders
  the server view — no timers anywhere in the fleet surface.)*
- [x] Refresh restores supported inventory and branch state; retained global/pool
  inventory visibility follows the approved ownership rules.
  *(GET /fleet is a fresh server projection per request (no-store); engagement
  scoping is enforced by `requireEngagementAccess` (owner or membership, viewer+).
  There is no global/pool inventory concept in the runtime contract — the fleet view
  is engagement-scoped only, per the graph-catalog decision in spec.md §8.)*

## Verification selection

Select agent/worker projection, branch lifecycle/dependency/action and changed
fleet/fanout UI tests. Exercise a real branch/fleet read and one required control
with a refusal case. Add targeted runtime tests only where its action contract
changes. Reuse 05's unchanged SSE/ledger tests; no full suite.

**Evidence:** `apps/web/server/tests/t13-fleet.test.ts` (3 tests: catalog/thread/branch
separation with observed counts + excludedActions; failing thread read renders honest
unknown + foreign 404; branch pairing polarity incl. failed/cancelled/restart). The
one required control (run cancel) reuses the unchanged ticket 05 cancel route/API and
its existing tests; refusal case exercised via foreign-engagement 404 and the recorded
exclusion of branch-level actions. No runtime action contract changed. Server suite
34 files / 313 tests green; web `src/real` 98 tests green; server+web typecheck and
lint clean.

## Scope boundary

Do not turn graph IDs from an assistant catalog into fabricated endpoint health.
Required control gaps cannot be closed by rendering a graph alone.
