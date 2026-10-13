# 29: Operation overview and live console

**What to build:** Migrate operation overview/live step logs and the human review-required gate to canonical reads/control services.
**Blocked by:** 28.
**Status:** ready-for-agent
**Owner:** Live operation workspace and step-review handlers.
**Contract:** [execution.md](../execution.md).

- [ ] Live steps/logs/status update from real simulation events; missing/stale data is shown honestly.
- [ ] AI cannot approve/skip/reject human-gated steps; handlers independently reject unauthorized decisions.
- [ ] Stop/failure/unknown banners, controls and evidence links remain scoped and usable with keyboard/light/dark layouts.
- [ ] Live route exercise covers allowed progress, review blocking and emergency stop; remaining detail tabs stay bridged.
