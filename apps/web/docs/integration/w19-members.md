# W19 — Members Identity Design (accepted 2026-10-02)

## Scope

Guide §12.12 (Members) plus the W19 outcome: real API enforcement with no
fake Owner/Viewer hierarchy. The auth bridge always resolves the local
operator and `isAuthEnabled()` is false, so hosted multi-user authentication
remains the dependency before any Invite/RBAC API.

## Server

- `services/members-service.ts` — `GET /api/engagements/:id/members` returns
  the truthful topology: `mode: 'local-single-user'`, the single operator row
  (`id: 'local'`, role `operator`, source `local`),
  `inviteSupported: false`, and the explicit reason naming the missing
  dependencies (hosted multi-user auth with sessions, CSRF, origin policy,
  enforced on every scoped API).
- Invite (`POST .../members`) and removal
  (`DELETE .../members/:memberId`) answer 503 with the reason — no member
  row is ever created, no silent no-op. Foreign engagements stay 404.
- Enforcement reality: every scoped API in this server already takes the
  owner `userId` first and resolves the single local identity; the W19 view
  states that honestly rather than inventing a membership schema.
- Capabilities: `members` is available when the view service is wired — the
  view itself is real; invite/RBAC stay stated-absent.

## Frontend

- `features/members/` — the members table with exactly the local operator,
  plus the "Not available in this build" invite/RBAC card carrying the
  server's reason and the explicit note that a frontend role dropdown is not
  enforcement. No Alex Kim/Sarah Rowe rows, no role dropdown, no invite form.
- The last unavailable reason is removed from `real-capabilities.ts`; every
  workspace page is now mounted real.

## Gates

- Contracts: 45 tests (member + members validators, including the invariant
  that `inviteSupported: true` is invalid in this mode).
- Server: 211 tests total, including `w19-members.test.ts` (truthful view,
  503 invite/removal with reasons, empty memberId 400, foreign 404s,
  capabilities).
- Frontend: real lane 29/29 includes `real-members.spec.ts` (real view, no
  demo people, stated-absent invite/RBAC); mock lane 8/8.
- Verifier `--w19` (10 groups): members view asserts, 503 invite/removal with
  reasons, foreign 404, capability assert; evidence `w19-live.json`.

## Non-goals / next

Project memberships, invite lifecycle, role authorization and multi-user
tests require the authentication strategy (sessions, CSRF, origin policy)
as a prior work package; until then the single-operator topology is the only
honest state.
