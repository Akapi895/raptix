# 07: Enforce real identity, roles and team access

**What to build:** Team and permission controls reflect trusted server identity
and the deployment's actual authorization model, enabling independent actors
only when the approved authentication strategy supports them.

**Blocked by:** 03 (real bootstrap and projects).
**Status:** ready-for-agent
**Requirements:** R03, R05, R08, R09, R10; decisions D1/D5.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Implement the identity/release choice from 01. Local-only mode remains
  explicitly local with no demo role selector accepted as authentication; if
  multi-user parity is required, implement the approved identity/session strategy
  and persisted memberships before enabling independent approval controls.
- [ ] Team views and supported invite/remove/role actions use owned API data,
  persistent identities and server-side checks. Enforce the chosen session/origin
  protections at the HTTP boundary, not in React alone.
- [ ] Server permission checks cover relevant roles, membership, ownership and
  read-only contexts. Client-supplied actor/role changes and foreign IDs cannot
  bypass authorization; UI visibility explains actual permission decisions.
- [ ] Provide the trusted actor/independent-approver contract downstream governance
  requires. A single local identity cannot approve its own work by changing its
  display name or selecting a second demo persona.
- [ ] Verify cache/stream disposal on identity changes and document which team or
  four-eyes features remain explicitly excluded in an approved local-only scope.

## Verification selection

Select identity/session/access and team UI/service tests plus the scoped read/
mutation cases whose authorization changed. Verify allowed/denied/foreign-ID and
forged-role requests directly against the server. Exercise two distinct actors
only if multi-user mode is implemented. Static checks for changed packages; do
not run unrelated feature suites/full suite as an auth ritual.

## Scope boundary

No unsolicited SSO/MFA product expansion. If 01 retains local-only scope, an
explicit requester-approved exclusion is required for multi-user parity; absence
of auth is never sufficient to mark independent approvals implemented.
