# 03: Shared domain and service contracts

**What to build:** Extract entity/status/permission types and define typed async service results, pagination and explicit actor/project context. Preserve existing imports through compatibility exports. Implementations belong to feature owners.
**Blocked by:** 02.
**Status:** ready-for-agent
**Owner:** Shared contracts.
**Contract:** [execution.md](../execution.md).

- [ ] Each domain type has one definition; legacy imports remain valid through re-exports.
- [ ] Service contracts specify success/error, not-found/forbidden and pagination behavior without `any` or ambiguous optional success data.
- [ ] Actor, project, absolute deadlines and entity-change identities support the single-authority bridge and fake clock.
- [ ] The Proposed boundary ADR is referenced; findings/evidence contracts preserve opaque references and capture-integrity vocabulary.
