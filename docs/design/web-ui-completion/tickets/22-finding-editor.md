# 22: Analyst finding create/edit/revision

**What to build:** Operator tạo/sửa findings từ Web, interoperable với runtime-produced files và canonical KG knowledge.
**Blocked by:** None (can start immediately).
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR defines finding identity, analyst revision/write attribution and canonical KG/file/metadata responsibilities; no competing source of truth.
2. Expose versioned create/edit command and strict editable schema; preserve runtime import/parser quality flags.
3. Add form/detail/save/conflict/refresh UX with actual server ACK and immutable record history.
4. Keep runtime and analyst findings searchable/exportable together; malformed runtime input remains inspectable.
5. Protect ongoing runtime writes from stale analyst save via expected revision/merge policy.

## Acceptance criteria
- [ ] Analyst create/edit persists after API restart and appears in read/report inputs.
- [ ] Runtime finding remains discoverable, traceable and editable under documented policy.
- [ ] Stale edit conflicts; manual text never silently becomes verified evidence.

## Test / expected result
L11 real runtime finding plus UI-created record, competing editors/runtime writer, invalid fields and foreign access. Test actual persisted revisions, not mocked save call.

## Completion evidence
Canonical ownership decision, before/after finding IDs/revisions/attribution and conflict/reload evidence.
