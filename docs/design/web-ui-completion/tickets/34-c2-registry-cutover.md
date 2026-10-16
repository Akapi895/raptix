# 34: Sliver listeners/profiles/sessions cutover

**What to build:** C2 page thấy actual owned listeners/HTTP profiles/sessions trên deployment thay vì provider_unavailable.
**Blocked by:** 17 — Authenticated provider connection probes.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Reuse native Sliver typed bridge and accepted/proposed C2 scope; verify native version and transport credentials privately.
2. Resolve registry/Vault configuration, authenticate native read probe and derive truthful provider readiness.
3. Wire listener start/list/stop, supported HTTP profile create/list and owned session refresh/detail.
4. Persist attribution and restored listener intents; inactive/unattributed sessions stay hidden or explicitly unusable as contract dictates.
5. Deploy current bridge/API/UI and verify graceful restart/session reconnect with actual lab target.

## Acceptance criteria
- [ ] Native lab session appears only in owning engagement.
- [ ] Profile/listener operations persist and agree with native provider after restart.
- [ ] No browser implant generation, arbitrary traffic config or interactive Shell expansion.

## Test / expected result
L16 existing native lab harness enrols isolated Linux target; owned distinct listeners, native profile/session IDs, foreign discovery denial and bridge outage.

## Completion evidence
Sliver/bridge version, profile/listener/session IDs, actual reconnect/readiness observations and denial checks.
