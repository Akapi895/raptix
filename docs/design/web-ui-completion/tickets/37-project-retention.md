# 37: Archive/delete/retention/provider cleanup

**What to build:** Project lifecycle từ Web có consequences chính xác cho active runs, provider resources, secrets và retained artifacts.
**Blocked by:** 14 — Project workflow; 32 — GoPhish; 33 — Evilginx2; 35 — C2 commands.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR defines archive/delete distinction, owned resource cleanup and retention/audit policy; database delete not disguised as filesystem purge.
2. Inventory project-linked runtime holds, uncertain jobs, provider resources and artifact/secret references before transition.
3. Implement idempotent staged lifecycle command with explicit blocker/cleanup-pending/retained outcome.
4. Wire Settings summary/confirmation/progress and explicit retention choice; final state only after actual policy outcome.
5. Record cleanup failures/unknown outcomes with reconcile path; never auto-delete unrelated shared resources or rotate Vault bootstrap key.

## Acceptance criteria
- [ ] Active/uncertain work blocks finalization where policy requires.
- [ ] Owned resources clean or retain explicitly; residual artifacts not presented as fully deleted.
- [ ] Replay/restart preserves lifecycle job and audit, no cross-project cleanup.

## Test / expected result
L17 projects with native campaign/listener and active/uncertain run; settle and transition, compare native resources/DB/artifact manifests. Fault cleanup returns actionable pending/failure.

## Completion evidence
Retention decision, resource/lifecycle IDs, before/after native/artifact manifests and blocked/replay results.
