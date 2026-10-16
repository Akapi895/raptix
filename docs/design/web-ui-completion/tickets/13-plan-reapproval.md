# 13: Revalidation và approval invalidation

**What to build:** Chỉnh scope/plan làm stale approval rõ ràng; operator revalidate/reconfirm trước execution mới.
**Blocked by:** 03 — Versioned handoff; 12 — Planning editor.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define edited draft/current executable/confirmed bundle state transitions and active-run snapshot policy.
2. Calculate consistent bundle revision after doc changes; revalidation includes schema and cross-document invariants.
3. Invalidate confirmation when approved content changes; preserve prior revision/history for audit.
4. Show validation reasons and required 8-doc readiness separately from OPPLAN state; add refresh/compare/reconfirm UX.
5. Guard races between editor, planner write and new execution; no silent confirmation reuse.

## Acceptance criteria
- [ ] Changed approved scope blocks new execution until revalidated/reconfirmed.
- [ ] Invalid draft cannot replace effective approved plan unnoticed.
- [ ] Existing accepted run identifies its approved snapshot; subsequent run uses the new one.

## Test / expected result
L02/L07 actual planner + browser edits. Concurrent save/confirm/run gets either consistent accepted snapshot or conflict, never mixed documents authorized together.

## Completion evidence
Before/after fingerprints, approval invalidation/audit, required-vs-OPPLAN counts and concurrent outcome records.
