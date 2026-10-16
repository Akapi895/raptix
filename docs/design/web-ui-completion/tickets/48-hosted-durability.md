# 48: Hosted crash-durable runtime/control plane

**What to build:** Accepted operations/checkpoints/history survive process crash with defined RPO/RTO và no unknown-work redispatch.
**Blocked by:** 10 — Local durability; 45 — Team authentication.
**Priority / Profile:** P2 / TEAM-HOSTED; scope activation required.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR chooses supported durable runtime/checkpointer/control-plane deployment; define consistency, RPO/RTO and worker ownership model.
2. Expand compatible persistence/metadata protocol beside current local backend; migrate consumers in green slices, contract only after all callers migrate.
3. Persist reserve/dispatch/ACK/outcome/checkpoint identities with replay/reconciliation under process death.
4. Expose recovery state and required operator reconciliation for irrecoverable native unknown outcomes.
5. Run kill/restart at each commit boundary, simultaneous workers and paired backup/restore; preserve local supported SQLite profile.

## Acceptance criteria
- [ ] Crash recovery meets agreed RPO/RTO and retains accepted IDs/checkpoints.
- [ ] Competing recovery workers cannot redispatch same uncertain operation.
- [ ] Missing state reported truthfully; no claimed HA from replicas on shared SQLite.

## Test / expected result
L20 hosted portion kills API/runtime/worker between reserve/dispatch/ACK/commit, observes reconciliation and dispatch count. Graceful-only recreate is insufficient.

## Completion evidence
Accepted durability architecture, fault schedule, measured recovery targets, stable IDs and native dispatch counts.
