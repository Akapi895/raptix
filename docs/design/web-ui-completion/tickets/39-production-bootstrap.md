# 39: Reproducible production bootstrap

**What to build:** Fresh checkout/images/migrations/config có thể khởi động full local Web mà không container-copy hoặc hidden dev artifacts.
**Blocked by:** 11 — Core gate; 18 — Runtime settings; 19 — Vault; 32,33 — Campaigns; 35 — C2 commands.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Inventory current manifests/Compose/proxy/entrypoints and environment/bootstrap versus persisted settings boundaries.
2. Build shared exports, own Prisma client và source-built UI/API/runtime/bridges from clean checkout; real mode default for production.
3. Apply migrations to intended DB; bootstrap stable Vault key/private provider state without exposing credentials.
4. Verify canonical workspace/mount and public capabilities separately from actual operation probes.
5. Update bootstrap diagnostics/runbook with exact restart/rebuild requirements; dev prototypes must not be runtime production paths.

## Acceptance criteria
- [ ] Clean source build succeeds without generated files from another checkout.
- [ ] Actual UI calls API, provider operations available under configured scope.
- [ ] Missing env/migration/key/mount fails clearly; no demo production or docker-cp dependency.

## Test / expected result
L20 bootstrap plus L01/L08/L15/L16 smoke; negative mock-build canary fails operational smoke. Compose isolation checks stay green after changes.

## Completion evidence
Build revision/images, migration status, redacted config identities, runtime/providers smoke and fail-fast cases.
