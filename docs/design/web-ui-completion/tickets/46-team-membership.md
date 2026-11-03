# 46: Membership/invite/server RBAC

**What to build:** Members invite/accept/remove/roles persist và permissions được backend enforce across supported actions.
**Blocked by:** 45 — Team authentication/session slice.
**Priority / Profile:** P2 / TEAM-HOSTED; scope activation required.
**Status:** draft-awaiting-review.

## Steps
1. Approve permission matrix for read/edit/dispatch/reveal/probe/approval/provider/admin/export actions; define membership/invite lifecycle in ADR.
2. Persist actual invitations/memberships/role revisions; scoped IDs and invitation expiry/one-use semantics.
3. Enforce common authorization at owning service/transport boundaries, not a frontend dropdown.
4. Wire Members list/invite/accept/change/remove and UI permission-denied states; show actual resulting records.
5. Handle concurrent role edits, self-removal/last-owner policy and revoked membership effects.

## Acceptance criteria
- [ ] Two identities receive different actual permissions as approved matrix.
- [ ] Invite acceptance/role/remove persists and reload agrees.
- [ ] Foreign/expired invite/unauthorized role mutation denied by backend.

## Test / expected result
L19 real invitations/users with complete action permission matrix; direct API attempts verify controls beyond UI hiding. Role conflict returns explicit result, not silent privilege change.

## Completion evidence
Permission matrix, membership/invite/audit IDs, two-user browser/API results and local-mode regression.
