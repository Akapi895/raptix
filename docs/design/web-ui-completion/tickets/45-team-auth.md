# 45: Team authentication/session slice

**What to build:** TEAM-HOSTED có real login/logout/expiry và backend-established identity, giữ local mode riêng.
**Blocked by:** None (can start immediately after TEAM scope activation).
**Priority / Profile:** P2 / TEAM-HOSTED; implementation gated by explicit scope approval.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR selects identity/session strategy, trust boundaries, CSRF/origin policy and migration for existing local records; approve before schemas/code.
2. Implement first vertical login → session → owned engagement read → logout slice using selected supported identity provider.
3. Separate local bootstrap identity and hosted authenticated identity; public client cannot choose owner IDs.
4. Wire login/session-expiry/re-auth/logout UI and return-to-route; protected mutations require effective session.
5. Exercise actual identity provider/session lifecycle, invalid/expired credentials and revoked session.

## Acceptance criteria
- [ ] Backend derives identity, not browser role/owner field.
- [ ] Logout/expiry/revocation prevent subsequent protected requests.
- [ ] Existing local profile behavior preserved without falsely claiming team auth.

## Test / expected result
L19 auth portion two real identities, session expiry and protected API/navigation; B-lane session fixation/origin/CSRF cases according to accepted architecture.

## Completion evidence
Accepted architecture, real identity/session traces, denied post-logout requests and local regression.
