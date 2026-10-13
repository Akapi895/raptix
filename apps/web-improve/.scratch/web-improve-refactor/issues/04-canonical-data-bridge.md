# 04: One database and legacy/service transaction bridge

**What to build:** Move database ownership behind the canonical transaction/subscription bridge and inject its context into the service factory. Adapt legacy reads/mutations to that same authority; add a representative typed project read/write adapter, not handlers for every entity.
**Blocked by:** 03.
**Status:** ready-for-agent
**Owner:** Database, bridge, factory and clock lifecycle.
**Contract:** [execution.md](../execution.md).

- [ ] Legacy Context and services share one seed/snapshot; mutations are atomic and publish affected identities.
- [ ] A service mutation is observed by a legacy consumer and a legacy mutation by a service subscriber; IDs/counters remain coherent.
- [ ] Factory injection supplies the real handler with actor/project/clock; latency cancellation and deadline/sweep scheduling are testable.
- [ ] Reset replaces the one dataset, disposes pending callbacks/subscriptions and is deterministic when repeated; current app behavior and baseline tests remain intact.
