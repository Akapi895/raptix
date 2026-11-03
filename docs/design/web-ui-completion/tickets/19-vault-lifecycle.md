# 19: Vault dependency/revoke/audit UX

**What to build:** Secrets và integrations tham chiếu chúng có lifecycle rõ; reveal/revoke/audit/restart hoạt động thật.
**Blocked by:** 16 — Integration registry với Vault references.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Reuse existing encryption/store/reveal/revoke; inventory references before revocation and define new-use versus in-flight operation semantics.
2. Show scoped dependency count/labels without exposing plaintext; confirm revoke effect and no accidental key rotation.
3. Refresh integration readiness when secret revoked/unavailable; persisted key loss/decryption failures are explicit.
4. Make reveal temporary and audited, remove value on navigation/expiry; backend remains authority.
5. Verify store/restart/reveal/revoke with stable bootstrap key and secret references.

## Acceptance criteria
- [ ] List/reference DTOs never contain plaintext; reveal is explicit audited action.
- [ ] Revoke prevents new connector use and exposes affected integrations.
- [ ] Restart with stable key restores valid secret; wrong/missing key does not generate replacement success.

## Test / expected result
L08 actual Vault gate and reference lifecycle, foreign reveal/revoke denial and wrong-key test in isolated environment. No rotation on every bootstrap.

## Completion evidence
Audit IDs, ciphertext/reference persistence, dependency invalidation and masked browser/restart trace.
