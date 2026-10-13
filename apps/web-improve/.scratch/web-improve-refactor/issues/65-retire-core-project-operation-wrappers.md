# 65: Retire core/project/operation compatibility wrappers

**What to build:** Remove remaining zero-caller wrappers/registries from the core/project/operation legacy groups after definitions were retired incrementally by feature owners.
**Blocked by:** 64.
**Status:** ready-for-agent
**Owner:** Contraction batch A.
**Contract:** [execution.md](../execution.md).

- [ ] Import and route inventory prove each removed wrapper has no callers, including tests/demo/aliases.
- [ ] Delete at most eight wrapper files within ≤400 runtime lines; enumerate and split further if the residual inventory is larger.
- [ ] Core/project/operation routes still resolve directly and their baseline adapters use final interfaces only.
- [ ] Shared bridge/UI still needed by other groups remains intact until its dedicated contraction leaf.
