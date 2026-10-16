# 06: Durable tool activity replay

**What to build:** Live và reloaded thread đều giữ tool calls/output/groups với source và thứ tự đúng.
**Blocked by:** 05 — Run reconnect, lost ACK và idempotent recovery.
**Priority / Profile:** P0 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Review existing runtime record/transcripts/history seams; reproduce terminal snapshot mất root tool output.
2. Proposed ADR chọn durable public event record, stable keys/order/cursor, cap/retention và migration compatibility; tránh second competing recorder.
3. Persist observed events with actual engagement/thread/run identity; unattributed checkpoint events stay thread-level.
4. Expose bounded paginated replay and merge by stable identity/cursor; show explicit truncated/unavailable states.
5. Group consecutive tools at render time without changing durable original sequence; preserve failure/cancel/output metadata.

## Acceptance criteria
- [ ] Navigate/reload terminal thread giữ same observable tool groups và retained output.
- [ ] Reconnect/pagination không duplicate or fabricate run attribution.
- [ ] Large output capped explicitly; durable missing state không biến thành empty-success.

## Test / expected result
L05 actual mixed messages/tools, failing tool and long result; compare retained event identities/order after reload/recreate. Cursor replay and duplicate checkpoint/live input must merge once.

## Completion evidence
Record/schema decision, live-to-history comparison, digest/IDs, truncation and negative replay checks.
