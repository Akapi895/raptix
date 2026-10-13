# 36: Report review and immutable approved versions

**What to build:** Move report submit/approve/return and version snapshots into real handlers, preserving independent review and approved-content pinning.
**Blocked by:** 35.
**Status:** ready-for-agent
**Owner:** Report review/version policy.
**Contract:** [execution.md](../execution.md).

- [ ] Real actions reject author self-approval, wrong role/state and missing mandatory decision comments.
- [ ] Approval pins content/version; later edits create a new draft, never mutate the approved snapshot.
- [ ] Return/resubmit produces a traceable revision with reviewer notes and canonical history.
- [ ] Tests call real handlers for refusals/pinning and rendered review for explanatory gating; migrated baseline assertions stay intact.
