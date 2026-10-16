# 31: Notification preferences và real delivery

**What to build:** Waiting/failure/report/provider events sinh notifications thật theo persisted preferences và delivery outcomes.
**Blocked by:** 16 — Integration registry; 17 — Provider probes.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define notification event identity/preferences/channel schema and accepted notification connector in Proposed ADR.
2. Persist in-app inbox and delivery attempt ledger; integrate event producer through current owning services without duplicating source events.
3. Wire Settings preference save/reload and inbox/read/status/retry controls in existing shell/pages.
4. Deliver SMTP test channel through native mail sink; configured production channel remains explicit separate resource.
5. Handle dedupe/backlog/provider failure/revoked secret and disable semantics; avoid secret/foreign content in notification.

## Acceptance criteria
- [ ] Enabled eligible event produces one notification per channel identity.
- [ ] Disabled event suppresses delivery; failure remains retryable/inspectable.
- [ ] Native delivery evidence distinguishes acceptance from observed receipt.

## Test / expected result
L14 actual waiting/report/failure events and inbox/mail-sink messages; restart/replay/provider outage. Preferences reload affects new events without rewriting sent history.

## Completion evidence
Preference/event/delivery IDs, native received message metadata, dedupe and suppression/failure results.
