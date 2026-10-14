# 07: Enforce real identity, roles and team access

**What to build:** Team and permission controls reflect trusted server identity
and the deployment's actual authorization model, enabling independent actors
only when the approved authentication strategy supports them.

**Blocked by:** 03 (real bootstrap and projects).
**Status:** complete
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

## Evidence (2026-10-15)

- Identity/release choice implemented per D1: `RAPTIX_WEB_AUTH_MODE=multi`
  enables session auth (scrypt password hashes, opaque sha256-stored session
  tokens, HttpOnly SameSite=Strict cookies, per-session CSRF header on every
  mutation, same-origin enforcement) at the Fastify `onRequest` boundary
  (`server/src/auth/multi-user.ts`, `auth/request-identity.ts`); the trusted
  per-request actor reaches all existing route handlers through an
  AsyncLocalStorage identity view, so owner-scoped services keep working
  unchanged and concurrently safe. `local` (default) keeps the fixed local
  operator and never creates WebUser rows.
- Persisted memberships: `WebUser`/`WebSession`/`WebMembership` land in
  migration `20261015000000_web_identity_lifecycle` (first slice of the
  ADR-0069 frozen design; the whole web lifecycle schema ships in that
  migration). Bootstrap admin comes from server env only.
- Team UI: project detail "Team" tab reads the owned membership view and
  performs owner-only invite/remove/role changes; refusals render as errors,
  never optimistic rows. `@raptix/web-contracts` MembersView extended for
  `multi-user` mode; local view stays truthful.
- Four-eyes contract: `requireIndependentActor` + `assertNotExpired` +
  `requireEngagementAccess` (owner > operator > reviewer > viewer) are the
  shared enforcement helpers used by governance tickets 08-17.
- Tests: `server/tests/t07-auth-members.test.ts` (10) covers password
  primitives, login/logout/whoami, 401/CSRF/origin boundary, membership RBAC
  (allowed/denied/foreign-ID/forged-role), audit rows; web
  `src/real/screens/team.test.tsx` (4). Full server suite 290/290; web real
  suite 94/94 + team 4/4; typecheck/lint clean.
- Known bounded limitation (recorded, not hidden): runtime thread/run reads
  remain owner-scoped (Engagement.userId) in this build; membership roles
  govern the web workflow surfaces (tickets 08-17). Shared-surface cache
  disposal on identity change is handled by the session gate + per-ticket
  actor-scoped query keys.
