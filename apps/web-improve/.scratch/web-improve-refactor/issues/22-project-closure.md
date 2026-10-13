# 22: Closure policy and independent confirmation

**What to build:** Move closure checklist and request/confirm/reopen governance to real domain/handlers, including policy exceptions already exposed by the export.
**Blocked by:** 21.
**Status:** ready-for-agent
**Owner:** Closure domain/actions.
**Contract:** [execution.md](../execution.md).

- [ ] Checklist evaluates operations, live sessions, findings, delivery and approvals at request and confirmation, not just on page render.
- [ ] Documented no-findings waiver/agent reservation behavior is characterized and retained explicitly rather than silently dropped.
- [ ] Independent authorized confirmation is required; a late blocking change prevents closure; reopening requires role/reason and audit.
- [ ] Tests exercise real closure actions with each failed condition and valid completion; legacy/new close panels agree.
