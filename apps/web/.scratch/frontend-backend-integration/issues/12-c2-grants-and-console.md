# 12: Wire C2 sessions, grants and the real console

**What to build:** An operator inspects actual provider sessions/channels and
executes authorized commands through an approved, expiring session-access model
with truthful provider outcomes.

**Blocked by:** 07 (identity/roles), 08 (scope/ROE governance).
**Status:** complete (backend grants + gate + panel; live Sliver command path stays a named gap, see Evidence)
**Requirements:** R03-R05, R07-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [x] Overview/channel/session/detail/console read actual provider/API data;
  unavailable infrastructure or unreported fields never appear as seed health.
  Connection state and actor permission remain distinct.
  *(Grants surface reads `/c2/grants` only; the provider-backed console reads remain the W17
  c2 sessions/commands routes. Unavailable provider surfaces the truthful 503 envelope —
  `ProviderUnavailableError` — never seed data. Live session/listener/console verification
  against a real Sliver instance is a named gap: no Sliver in this environment.)*
- [x] Required request/review/reject/return/revoke/renew grant workflows persist
  actor, session, reason and absolute deadline; enforce independent review where
  the approved identity model supports it.
  *(t12 test 1: request persists actor/session/reason/deadline; viewer denied; duplicate
  pending 409; requester self-decision 403 via `requireIndependentActor`; reviewer
  approve/reject; revoke only from approved. Renewal = new request after expiry/rejection.)*
- [x] Every command authorizes against live scope/grant/expiry, including an
  in-flight completion recheck. Input locks at expiry; server-owned cleanup runs
  without a C2 screen and provides no 15-second authorization grace period.
  *(Grant gate wired as the third C2Service constructor dependency and invoked inside
  `dispatchCommand` after engagement authorization, before ledger reserve — including the
  replay/reconciliation path. Sweep marks expired grants lazily on read and gate read;
  t12 tests 2-3 cover -1ms refusal, no grace and sweep without a mounted console.)*
- [x] Commands retain stable request IDs, uncertain/reconcile states, bounded
  output and audited outcomes. Refresh/retry cannot dispatch duplicates.
  *(Pre-existing W17 ledger retained: `requestId` unique per engagement + payloadHash,
  replay returns the recorded command without re-executing; t12 test 2 replays one
  requestId with the provider execute counter proving a single dispatch.)*
- [x] Session termination/revocation status comes from the actual provider; losing
  a grant does not fake disconnection. Supply truthful session/grant state to 17.
  *(Grant expiry/revocation is grant state only — session connection state still comes
  from the provider via the W17 sessions read; the gate refusal message asks for a
  renewal instead of claiming disconnection.)*
- [x] Preserve any required campaign/provider-management placement approved under
  D5 in 01, reusing its existing real contracts; otherwise record the approved UI
  exclusion while retaining backend APIs and data. Do not silently drop the flow.
  *(C2 Access panel added as a project detail tab reading the real grants API; the
  campaign-management placement stays with the W17 campaigns surface unchanged.)*

## Verification selection

Select C2 provider projection/command ledger, grant policy/deadline/four-eyes and
console tests. Cover expiry -1/0/+1 and in-flight completion with no mounted
console. Exercise one provider-backed session command plus refusal/uncertainty;
if the provider is unavailable, retain an explicit live-verification blocker.
Reuse unchanged general identity/ROE evidence. No full suite.

**Evidence:** `apps/web/server/tests/t12-c2-grants.test.ts` (3 tests: lifecycle/four-eyes;
gate + expiry -1ms + requestId replay with execute counter; sweep-without-console +
foreign 404s). Provider-backed dispatch exercised against a stub `SliverClient` call
surface (`sessions.get`/`sessions.execute`); a real Sliver round-trip remains the
explicit live-verification blocker. Server suite 33 files / 310 tests green after the
change; web `src/real` 98 tests green; server+web typecheck and lint clean.

Later addition (same day, uncommitted until this update): the c2 surface split into
`RealC2Grants` + `RealC2Console` (sessions table, command dispatch form, command audit
table with per-command reconcile and a truthful 503 provider-unavailable banner) and a
`RealCampaignsPanel` (capability read, persisted drafts, generate/deploy provider jobs
with reconcile) mounted on the c2 surfaces per the D5 placement. Server tests
`iw09-c2.test.ts` (gate ordering: pre-reservation, post-reservation, post-invoke with
persisted truthful outcome on gate failure; reconcile persists outcome before the gate
recheck) and `t10-findings-workflow.test.ts` digest hardening (64-hex enforcement,
malformed digest 400) added; the workflow live harness (`workflow-live/899a8655`)
passes 12/12 on real PostgreSQL with the C2 TTL policy check included.

## Scope boundary

Existing provider-command support is not already a timed per-user grant system.
Mock console output cannot certify the real command or termination path.
