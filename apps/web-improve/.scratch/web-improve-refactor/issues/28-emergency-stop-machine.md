# 28: Emergency-stop state machine and propagation

**What to build:** Move the existing stop machine to canonical domain/service logic for operation/project/workspace scope, with fake-clock acknowledgements and explicit failure/unknown/manual-confirm outcomes.
**Blocked by:** 27.
**Status:** ready-for-agent
**Owner:** Stop protocol and atomic cross-entity propagation.
**Contract:** [execution.md](../execution.md).

- [ ] Authorized request with mandatory reason advances requested → acknowledged → stopped; fail/unknown/retry/manual-confirm behavior never reports fabricated success.
- [ ] Only affected operations/sessions/reservations change; out-of-scope records remain unchanged, including concurrent stop outcomes.
- [ ] Successful stop terminates sessions/revokes access and leaves execution halted; automatic callbacks cannot restart it.
- [ ] Real-handler regressions cover all scopes/outcomes; legacy C2 observes propagation before its migration, without a second database.
