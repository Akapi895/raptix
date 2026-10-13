# 30: Operation timeline, agents, results and graph

**What to build:** Complete operation detail read-only tabs with service-backed timeline, participating agents, results/evidence and step dependency SVG.
**Blocked by:** 29.
**Status:** ready-for-agent
**Owner:** Operation detail read models and graph.
**Contract:** [execution.md](../execution.md).

- [ ] All six agreed operation tabs resolve by search params/back-forward and use the same canonical operation.
- [ ] Graph/results distinguish executed, failed, unknown and not-run steps; no simulated proposal is displayed as execution evidence.
- [ ] Agent/evidence/technique links retain project scope; graph nodes have accessible interaction.
- [ ] No operation screen reads the legacy database/store directly; route-level empty/error/permission checks pass.
