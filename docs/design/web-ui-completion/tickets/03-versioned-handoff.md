# 03: Backend-enforced versioned handoff

**What to build:** Execution chỉ bắt đầu khi operator xác nhận đúng revision của bundle đã validate; direct API không bypass UI lock.
**Blocked by:** 02 — Canonical workspace cho planning và tools.
**Priority / Profile:** P0 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define confirmation revision/fingerprint and execution predicate trong Proposed ADR; phân biệt tám required docs với OPPLAN.
2. Add compatible persisted confirmation identity bên cạnh timestamp; legacy timestamp không tự được coi là reviewed revision.
3. Confirmation command reads/validates owned canonical bundle và persists identity atomically hoặc bằng revision guard.
4. Enforce predicate tại execution thread/run, applicable resume và retest entrypoints; giữ idempotent replay semantics.
5. Bind UI readiness/confirm/errors tới server result, show stale-confirmation reason; record plan snapshot cho accepted work.

## Acceptance criteria
- [ ] Valid nhưng chưa confirm vẫn không chạy execution qua UI/direct API.
- [ ] Missing/invalid bundle không thể confirm thành ready.
- [ ] Concurrent edit/confirm/submit không authorize sai revision; stale client nhận conflict.

## Test / expected result
L02 with actual DB/runtime plus API barriers for races. Old revision replay cannot arm new bundle; confirmed unchanged revision allows exactly one accepted dispatch. Migration/backfill test preserves existing metadata without granting implicit confirmation.

## Completion evidence
Predicate matrix, migration result, race outcomes và actual denied/accepted run IDs.
