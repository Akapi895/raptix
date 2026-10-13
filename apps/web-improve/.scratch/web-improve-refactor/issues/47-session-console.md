# 47: Grant-bound simulated console

**What to build:** Migrate console/history/transcript/events/evidence/policy panels using 46's real authorization and deadline notifications.
**Blocked by:** 46.
**Status:** ready-for-agent
**Owner:** Console UI and command completion adapter.
**Contract:** [execution.md](../execution.md).

- [ ] Interactive controls require a live grant; readable transcript follows existing read-only policy rather than being hidden merely because interactive access is absent.
- [ ] Input locks at the deadline with renewal path; a queued/in-flight command rechecks authorization before producing output.
- [ ] Revoke/stop/disconnect/scope changes lock appropriately and retain distinct explanations; masking and linked panels remain scoped.
- [ ] Test the real command handler and rendered deadline separately; legacy console direct-state consumers are retired.
