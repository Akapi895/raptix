# 44: AI worker dependency graph

**What to build:** Migrate the worker/DAG presentation and branch dependency read model separately from branch actions.
**Blocked by:** 43.
**Status:** ready-for-agent
**Owner:** Worker read model/SVG graph.
**Contract:** [execution.md](../execution.md).

- [ ] Worker nodes/status/dependencies reflect recorded canonical data and remain project-scoped.
- [ ] Keyboard/focus navigation reveals the same node detail as pointer interaction; labels and theme contrast remain legible.
- [ ] Empty/error/missing dependency cases are explicit; graph state never grants execution permissions.
- [ ] Existing fanout/workspace entry points stay reachable; graph-specific legacy readers are retired.
