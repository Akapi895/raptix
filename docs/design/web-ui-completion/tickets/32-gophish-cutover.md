# 32: GoPhish normal-deployment cutover

**What to build:** Existing campaign draft/prepare/deploy/reconcile hoạt động qua registry và real-mode Web trên deployment nghiệm thu.
**Blocked by:** 17 — Authenticated provider connection probes.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Reconcile current implementation with campaign ADR/native lab evidence; update stale status without rebuilding working logic.
2. Connect registry/Vault config to owning client; select native template/page/group/SMTP refs through authorized UI.
3. Deploy current API/UI/provider lab images, apply needed schema and enable explicit existing lab deployment mode.
4. Wire prepared bundle/version/request/native IDs/counts and real reconcile errors; preserve same-intent ledger/unknown lock.
5. Verify reload/API restart, manifest drift, stale version and unavailable provider before normal deployment claim.

## Acceptance criteria
- [ ] UI prepare/deploy/reconcile matches actual native lab campaign/counts.
- [ ] Retry does not send another message for same intent; stale manifest/version conflicts.
- [ ] Missing provider unavailable; no SMTP secrets/recipient records leaked in DTOs.

## Test / expected result
L15 GoPhish half: isolated example.test/mail-sink, observe one native message, native provider ID and reconcile counts after restart. SMTP accepted is not external inbox-delivered.

## Completion evidence
Image/config/version identities, native campaign/job IDs, mail-sink observation and replay/foreign/failure results.
