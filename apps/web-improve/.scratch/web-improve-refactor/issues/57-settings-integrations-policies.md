# 57: Integration and policy settings

**What to build:** Migrate integration connect/disconnect and policy configuration/save/reset through typed admin handlers.
**Blocked by:** 56.
**Status:** ready-for-agent
**Owner:** Integration/policy settings handlers and panels.
**Contract:** [execution.md](../execution.md).

- [ ] Allowed settings save/reset with validation and session persistence; unauthorized actions fail at the handler.
- [ ] Secrets remain masked and connection outcomes explicitly simulated; no real provider call is introduced.
- [ ] Destructive changes confirm reasons and record actor/timestamp/audit.
- [ ] Policy settings never silently bypass the real operation/grant gates; compatibility settings state remains coherent.
