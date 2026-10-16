# 07: Durable question-answer history

**What to build:** Accepted answers và question provenance còn sau reload/restart, không chỉ local answered-ID list.
**Blocked by:** 04 — Planning Q&A/status; 06 — Durable tool activity replay.
**Priority / Profile:** P0 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define accepted answer record linking question/interrupt/request/resume identities and bounded values.
2. Persist after authoritative accepted resume, preserving pending/uncertain distinction; no success inferred from optimistic UI clear.
3. Add history projection/replay for original options and answer values; dedupe checkpoint/live paths.
4. Restore ANSWER display and panel eligibility after reload; draft answers use explicit discard/persist policy separate from accepted answers.
5. Redact/restrict any secret-valued answers theo chosen public contract without losing question identity.

## Acceptance criteria
- [ ] Reload retains exact accepted multi-select/free-text answers attached to correct questions.
- [ ] Unaccepted/failed resume không được render như answered success.
- [ ] New follow-up ID cannot be hidden by an old answered marker.

## Test / expected result
L03/L05 with accepted, uncertain and rejected resumes; restart API/runtime and compare question/answer associations. Duplicate event delivery shows one answer record.

## Completion evidence
Answer/recovery identities, source fields and reload screenshots with observed submitted values.
