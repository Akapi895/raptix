# 35: C2 command outcomes/replay/reconciliation

**What to build:** Explicit path+argv command qua Web có native output/audit, reload và uncertain reconciliation không duplicate execution.
**Blocked by:** 05 — Run recovery semantics; 34 — Native C2 registry cutover.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Align existing command request ledger, session lock and native outcome semantics with public recovery model.
2. Wire path/argv validation, scoped session selector and explicit request identity; no implicit shell insertion.
3. Retain exit/stdout/stderr/truncation/provider status and audit, display pending/uncertain/terminal honestly.
4. Reconcile by native recorded outcome after timeout/restart; forbid automatic redispatch of unresolved work.
5. Complete failure correction UX so invalid input can be fixed without accidentally replaying a different intent under same identity.

## Acceptance criteria
- [ ] Actual command output/exit status survives reload/API/bridge restart.
- [ ] Same intent replay same command; changed input conflicts.
- [ ] Unknown outcome holds ownership until resolved; foreign/dead session denied.

## Test / expected result
L16 benign Linux command, nonzero, bounded long output, lost ACK and timeout; native marker proves one execution per identity. Failed result not decorated as success.

## Completion evidence
Command/request/session IDs, native exit/output cap, persisted audit and replay/restart/race traces.
