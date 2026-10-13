# 46: Session requests and exact grant deadlines

**What to build:** Migrate session detail/request/approve/return/reject/revoke with real independent review and deadline authorization. Move expiry scheduling out of mounted C2 screens into canonical service lifecycle.
**Blocked by:** 45.
**Status:** ready-for-agent
**Owner:** Session access policy, grant handlers and expiry lifecycle.
**Contract:** [execution.md](../execution.md).

- [ ] Real request/decision actions enforce actor/project/role/self-review and required reasons; grant is per user/session.
- [ ] Authorization denies interactive commands at `now >= expiresAt`, even with no C2 page mounted or before the next 15s sweep.
- [ ] Deadline notification updates access/countdown; sweep removes expired records/audits without a grace period or terminating the connected session.
- [ ] Tests cover deadline−1/deadline/deadline+1, revoke/stop/reset and repeated mounting; bridged legacy commands use the same authorization.
