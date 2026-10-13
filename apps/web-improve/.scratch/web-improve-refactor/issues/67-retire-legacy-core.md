# 67: Remove the final legacy store/navigation/UI bridge

**What to build:** Remove residual Context/store/hash-router/UI forwarding infrastructure after all screen consumers are gone; keep the canonical database/services/providers as the final architecture.
**Blocked by:** 66.
**Status:** ready-for-agent
**Owner:** Final core contraction.
**Contract:** [execution.md](../execution.md).

- [ ] No component/test/demo reads the old store/database or writes location outside the router; remaining compatibility definitions have zero callers.
- [ ] Final seed/reset/timers/subscriptions belong to canonical services; removal does not reseed data or break observable events.
- [ ] Runtime deletion is measured and split if needed; no oversized monolith deletion is assumed exempt.
- [ ] Typecheck/lint/test/build pass with zero remaining migration diagnostics and final-interface invariant coverage only.
