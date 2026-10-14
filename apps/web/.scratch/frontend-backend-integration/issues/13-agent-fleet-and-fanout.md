# 13: Integrate agent fleet and fanout control

**What to build:** Users inspect actual agent/worker inventory, health and branch
execution and perform only supported allocation/retry/reassign/cancel operations
with engagement-scoped outcomes.

**Blocked by:** 05 (execution, streaming and recovery).
**Status:** ready-for-agent
**Requirements:** R03-R05, R07-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Distinguish assistant graph catalog, subagent/worker invocation and deployed
  endpoint identity in fleet/detail and fanout/branch views. Source each field
  from the owning runtime/provider; missing heartbeat data is not fabricated.
- [ ] Timeline/dependency/worker-graph views use observed IDs and events with
  provenance. Replay cannot double-count branches or attribute history to a new
  run; scope switching drops old branch callbacks.
- [ ] Required group/allocation/branch action APIs are implemented against real
  runtime semantics or explicitly excluded by 01. Retries and cancellation retain
  stable identity, authorization, concurrency and uncertain outcome handling.
- [ ] Branch completion/failure/unknown statuses and reassignment are server-
  authoritative. No frontend timer changes a worker to online or completed.
- [ ] Refresh restores supported inventory and branch state; retained global/pool
  inventory visibility follows the approved ownership rules.

## Verification selection

Select agent/worker projection, branch lifecycle/dependency/action and changed
fleet/fanout UI tests. Exercise a real branch/fleet read and one required control
with a refusal case. Add targeted runtime tests only where its action contract
changes. Reuse 05's unchanged SSE/ledger tests; no full suite.

## Scope boundary

Do not turn graph IDs from an assistant catalog into fabricated endpoint health.
Required control gaps cannot be closed by rendering a graph alone.
