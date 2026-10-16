# 33: Evilginx2 typed-bridge cutover

**What to build:** Existing typed prepare/deploy/inspect workflow dùng actual synthetic lab bridge và Web registry config.
**Blocked by:** 17 — Authenticated provider connection probes.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Review existing native bridge ownership/version and Proposed campaign ADR; align documentation with observed implementation.
2. Configure typed connector via registry/Vault references with supported synthetic lab scope.
3. Wire profile/prepare/enable/reconcile UI to native states; no browser shell/console forwarding.
4. Persist same-intent provider IDs/jobs and unknown outcomes; restart bridge/API and inspect same owned configuration.
5. Expose unavailable/fingerprint conflict/failed enable clearly without retry redispatch or session-capture DTOs.

## Acceptance criteria
- [ ] Prepare/deploy/reconcile shows actual native prepared/enabled state.
- [ ] Reload/restart/replay retains ownership/version and does not duplicate resources.
- [ ] Foreign ownership denied; tokens/cookies/captured credentials never returned.

## Test / expected result
L15 synthetic login.origin lab via typed bridge, native inspect before/after restart, lost ACK and foreign reconcile. A successful configuration enable is not represented as captured login/session.

## Completion evidence
Bridge/native version/config ID, actual inspected state and restart/identity/error/redaction evidence.
