# 12: Versioned planning document editor

**What to build:** Operator chỉnh tám planning documents từ Charter/Scope, save/reload và resolve conflicts qua Web.
**Blocked by:** 02 — Canonical workspace cho planning và tools.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR chooses versioned write API, draft-vs-executable semantics and concurrent-write strategy over canonical storage.
2. Expose validated editable fields/schema and current revision; cover all eight docs, not only public read projection's four sections.
3. Add editor/save/cancel/change summary; validation errors map to fields and unknown secret/private fields stay protected.
4. Persist atomically with expected revision; invalid draft may be retained separately but not become executable state.
5. Reload canonical saved revision and provide conflict refresh/compare UX; Scope uses same editor contract.

## Acceptance criteria
- [ ] All eight docs can be corrected without host filesystem access.
- [ ] Concurrent editors do not silently overwrite; rejected draft does not corrupt current valid doc.
- [ ] Ready/missing/invalid/unavailable reasons match actual persistence.

## Test / expected result
L07 across all docs with omitted scope/enums/invalid JSON and two-browser competing saves. Correct save persists after API restart; invalid/conflict response keeps user's draft recoverable.

## Completion evidence
Write/version decision, actual saved revisions, field-error/conflict/reload traces and preserved original document proof.
