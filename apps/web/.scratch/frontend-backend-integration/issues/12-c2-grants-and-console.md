# 12: Wire C2 sessions, grants and the real console

**What to build:** An operator inspects actual provider sessions/channels and
executes authorized commands through an approved, expiring session-access model
with truthful provider outcomes.

**Blocked by:** 07 (identity/roles), 08 (scope/ROE governance).
**Status:** ready-for-agent
**Requirements:** R03-R05, R07-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Overview/channel/session/detail/console read actual provider/API data;
  unavailable infrastructure or unreported fields never appear as seed health.
  Connection state and actor permission remain distinct.
- [ ] Required request/review/reject/return/revoke/renew grant workflows persist
  actor, session, reason and absolute deadline; enforce independent review where
  the approved identity model supports it.
- [ ] Every command authorizes against live scope/grant/expiry, including an
  in-flight completion recheck. Input locks at expiry; server-owned cleanup runs
  without a C2 screen and provides no 15-second authorization grace period.
- [ ] Commands retain stable request IDs, uncertain/reconcile states, bounded
  output and audited outcomes. Refresh/retry cannot dispatch duplicates.
- [ ] Session termination/revocation status comes from the actual provider; losing
  a grant does not fake disconnection. Supply truthful session/grant state to 17.
- [ ] Preserve any required campaign/provider-management placement approved under
  D5 in 01, reusing its existing real contracts; otherwise record the approved UI
  exclusion while retaining backend APIs and data. Do not silently drop the flow.

## Verification selection

Select C2 provider projection/command ledger, grant policy/deadline/four-eyes and
console tests. Cover expiry -1/0/+1 and in-flight completion with no mounted
console. Exercise one provider-backed session command plus refusal/uncertainty;
if the provider is unavailable, retain an explicit live-verification blocker.
Reuse unchanged general identity/ROE evidence. No full suite.

## Scope boundary

Existing provider-command support is not already a timed per-user grant system.
Mock console output cannot certify the real command or termination path.
