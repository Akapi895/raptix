# 40: Approved plan to draft operation

**What to build:** Connect approved plans to the existing canonical operation creation/control APIs; the AI feature consumes these APIs instead of editing their modules.
**Blocked by:** 39, 27.
**Status:** ready-for-agent
**Owner:** Plan-operation orchestration adapter.
**Contract:** [execution.md](../execution.md).

- [ ] An authorized human creates a correctly linked draft operation from a valid approved plan; repeated requests do not duplicate it.
- [ ] Draft/proposed/rejected/expired/wrong-project plans cannot bridge, and chat never calls execution controls.
- [ ] The actual operation API rejects start/resume requiring expired approval and failed current preflight, including changes between click and commit.
- [ ] New operation is visible in migrated and legacy consumers; plan approval itself never starts it.
