# 16: Integration registry với Vault references

**What to build:** Operator cấu hình supported integrations qua Web bằng secret references, không phải sửa env cho nghiệp vụ hằng ngày.
**Blocked by:** None (can start immediately).
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR separates bootstrap secret/key from application integration records; defines supported connector types, ownership and versioned references.
2. Add persisted registry using existing Vault identities; validate type-specific endpoint/resource fields server-side.
3. Resolve credentials only in owning backend connector; protect TLS/redirect/bounded-request policy and secret isolation.
4. Wire Settings create/edit/disable/list to actual persisted records, show configured-not-probed state.
5. Verify restart, stale revision, invalid reference and cross-engagement access outcomes.

## Acceptance criteria
- [ ] Save/reload/restart preserves record/version and valid scoped secret reference.
- [ ] Public DTO/export/log never includes secret bytes.
- [ ] Browser input cannot select arbitrary runtime/host execution or unauthorized network destination.

## Test / expected result
L08 with actual Vault/DB and configured supported provider; negative foreign/revoked secret and invalid endpoint validation. Persisting record alone is not connectivity success.

## Completion evidence
Registry/secret-resolution decision, versioned records, redaction checks and real connector credential use.
