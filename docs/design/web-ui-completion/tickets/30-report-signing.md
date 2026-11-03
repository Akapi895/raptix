# 30: Report signing và integrity verification

**What to build:** Operator ký retained report artifact và kiểm tra chữ ký/bytes qua Web, không nhầm signature với truth validation.
**Blocked by:** 28 — PDF/DOCX rendering và downloads.
**Priority / Profile:** P2 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR defines artifact-signature format, signer identity, key bootstrap/storage and verification contract; do not implement custom cryptography.
2. Sign actual retained digest/manifest through bounded signing boundary; secret key never reaches browser/download DTO.
3. Persist signature/public verification metadata bound to exact report artifact version.
4. Wire explicit sign/verify/status/download signature UI; distinguish unsigned/valid/invalid/unknown signer.
5. Preserve old signature verification when source/template/report changes or signer keys rotate under documented policy.

## Acceptance criteria
- [ ] Original report bytes verify; modified byte/version fails.
- [ ] Key material absent from public metadata/export/log.
- [ ] Signing outcome certifies bytes, not correctness of claims; failed signer not marked signed.

## Test / expected result
L13 actual signing provider/key boundary with retained file; tamper, unavailable signer and old-version verification. Restart retains signature/report association.

## Completion evidence
Signature-format decision, artifact/signature IDs, valid/tampered checks and key-redaction proof.
