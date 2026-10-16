# 42: Release/install/update/rollback gate

**What to build:** Release assets cài/update Web đúng images/config/migrations và khôi phục theo compatibility policy giữ data.
**Blocked by:** 39 — Production bootstrap; 40 — LOCAL-FULL acceptance; 41 — CI quality.
**Priority / Profile:** P1 / Distribution.
**Status:** draft-awaiting-review.

## Steps
1. Inspect current build/publish/sign/promote/pin/recover/install/update lifecycle and align supported image/config inventory.
2. Define migration compatibility, backup prerequisites and rollback-versus-restore rule; refuse unsupported schema downgrade.
3. Publish a release candidate through existing workflows only after user authorizes release execution in implementation phase.
4. Fresh-install actual tagged assets; update from supported previous release and rerun core/provider smoke.
5. Exercise digest verification, failed update and documented compatible rollback/recovery in isolated install.

## Acceptance criteria
- [ ] Actual release assets install/start correct real-mode stack.
- [ ] Update keeps projects/checkpoints/artifacts/Vault references and config snapshot semantics.
- [ ] Failed pull/config/checksum/migration does not stamp successful installed version or destroy prior data.

## Test / expected result
L20 release portion using actual registry/assets, not local renamed image as published release proof. Recovered deployment passes local smoke; unsupported downgrade errors explicitly.

## Completion evidence
Release/run URLs, asset/digest/version manifest, fresh-install/update/recovery results and preserved record/digest comparison.
