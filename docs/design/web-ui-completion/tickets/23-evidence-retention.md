# 23: Evidence upload/link/retained integrity

**What to build:** Finding liên kết tới bytes được retained và inspectable với evidence identity/digest/producer lineage rõ.
**Blocked by:** 22 — Analyst finding create/edit/revision.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Reuse retained-capture/evidence model; define upload/reference/link contract and bounded allowed artifact types/sizes.
2. Persist immutable bytes/digest/provenance; operator upload records operator source, không giả scanner producer.
3. Link finding revision to evidence reference atomically; prevent foreign/path escape and partial-file success.
4. Add browse/upload/link/preview/download/integrity UI with explicit caps and missing/tampered status.
5. Keep copies/aliases linked to original producer lineage; cleanup orphan upload by defined retention policy.

## Acceptance criteria
- [ ] Downloaded bytes match recorded digest and stable evidence identity after restart.
- [ ] Tampering/missing bytes show integrity failure, not verified claim.
- [ ] Foreign/traversal/oversized link or upload rejected without leaked artifact.

## Test / expected result
L11 actual upload/capture/download hash; tamper isolated copy, interrupt upload and test foreign evidence link. Integrity pass is not labeled exploitability/independent corroboration.

## Completion evidence
Evidence reference/digest/source lineage, authorized downloads and tamper/partial-upload outcomes.
