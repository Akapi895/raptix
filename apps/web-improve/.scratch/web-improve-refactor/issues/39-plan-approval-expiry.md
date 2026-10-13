# 39: Independent plan approval and 24-hour enforcement

**What to build:** Migrate plan request/approve/reject/return/revise policy with independent reviewer, current ROE binding and a real absolute approval deadline.
**Blocked by:** 38, 26.
**Status:** ready-for-agent
**Owner:** Plan approval/version/expiry handlers, not the operation control module.
**Contract:** [execution.md](../execution.md).

- [ ] Author/requester cannot self-approve; role, justification, version and current ROE binding are checked by real handlers.
- [ ] Approval sets expiry to decision time +24h; seeded deadlines remain explicit. Re-approval is an independent decision, not a silent timer extension.
- [ ] Deadline−1/deadline/deadline+1 tests exercise the real policy without an AI page mounted; expired approval is unusable even before cleanup runs.
- [ ] Scope submission invalidation from 21 stays immediate; version revision leaves the pinned executed/approved plan traceable.
