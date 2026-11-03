# 04: Planning Q&A và effective waiting status

**What to build:** Interview một/nhiều câu dùng CONFIRM/resume đúng; console luôn cho biết đang chạy hay đang chờ operator.
**Blocked by:** 02 — Canonical workspace cho planning và tools.
**Priority / Profile:** P0 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define effective status từ native run + thread interrupts + approvals + recovery, với precedence rõ; giữ raw source status inspectable.
2. Reconcile plural/singular legacy pending questions và interrupt IDs; validate exact coverage trước resume.
3. Complete first-question navigation, multi-select/free text/CONFIRM, draft state và retry/error states.
4. Clear pending only theo authoritative acknowledgement/checkpoint; không dùng run success để gọi engagement completed.
5. Show follow-up question, empty-answer/conflict/unavailable errors và guidance không làm mất selections.

## Acceptance criteria
- [ ] Run native success + pending question hiển thị waiting-for-answers.
- [ ] Multi-question resume maps đúng IDs và không bỏ sót câu.
- [ ] Follow-up riêng vẫn answerable; draft navigation không reset selection.

## Test / expected result
L03, actual model produces simultaneous interrupts. Incomplete/duplicate/stale IDs reject; confirmed all answers resumes once and returns a new run identity. Status precedence contract tests cover contradictory native inputs.

## Completion evidence
Native interrupt IDs, submitted selections, ACK/resume IDs, screenshots for waiting/running/completed/failure.
