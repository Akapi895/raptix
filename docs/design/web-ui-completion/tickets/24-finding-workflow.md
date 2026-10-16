# 24: Finding workflow và verification records

**What to build:** Finding status/review/local responsibility có persistence và audit; “verified” dựa trên verification record thực.
**Blocked by:** 22 — Finding editor; 23 — Evidence retention.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define lifecycle transition matrix, local-operator responsibility and distinction recorded/reviewed/verified/contradicted.
2. Add versioned transition commands with write attribution, reason and supporting verification references where required.
3. Link immutable verification record/capture to eligible transition; manual review does not invent observed execution.
4. Wire status/review controls/detail history; unsupported transitions visibly denied.
5. Reconcile runtime/analyst status updates and reporter snapshots without silent regressions.

## Acceptance criteria
- [ ] State/reason/attribution persist and reload accurately.
- [ ] Verified requires valid qualifying record; timeout/manual toggle cannot fabricate verification.
- [ ] Concurrent transition conflicts rather than losing history.

## Test / expected result
L11 positive review/verification with actual evidence, negative no-record/foreign-record/stale-revision cases. Reports distinguish reviewed claim from corroborated finding.

## Completion evidence
Transition matrix, actual state history and verification/evidence references with denied-transition results.
