# 06: Login and permission policy

**What to build:** Port persona login/logout and RBAC into the shared auth authority/permissions interface, with a service-backed project membership view. Preserve the 19-action role model and explanatory gating.
**Blocked by:** 05.
**Status:** resolved
**Owner:** Auth feature and permission policy.
**Contract:** [execution.md](../execution.md).

- [x] Login selects persona/organization; logout and persona switch update legacy and migrated surfaces consistently.
- [x] Matrix regressions preserve 6 × 19 decisions plus viewer/member/nonmember and closed/cancelled cases.
- [x] New action handlers have an explicit actor/project context; UI modes never grant authorization.
- [x] Existing login remains wired during router migration; baseline adapters change without weakening assertions.

## Evidence

Implementation (new `src/auth/` module — one concern: the auth/permission authority):

- `src/auth/policy.ts` — the shared permissions interface: the 6-role × 19-action matrix (`ROLE_ACTIONS`, ported verbatim from the legacy `can()` switch with a compile-time cover-all guard), the membership rule `projectAccessible` (elevated roles admin/manager/reviewer reach every project; others need a membership entry), `can(actor, action, project?)` (membership first → closed/cancelled context → role matrix) and `readOnlyContext`. Every decision takes actor and project explicitly — UI modes/panels are not inputs.
- `src/auth/persona.ts` — auth feature actions `signIn`/`switchPersona`/`signOut` writing through the ticket 05 shared auth store, plus the single identity resolution (`personaRole`, `actorRef`) now also consumed by `state/keys.ts` (`useQueryScope`) and `state/query.tsx` (`supersedeScope` → `cancelScope`), replacing their duplicated `USERS` lookups.
- `src/auth/membership.ts` — the service-backed membership view: `listProjectMemberships` is a typed read through the factory (`forScope(actor, projectId).list(ctx)`), `accessibleProjectIds` resolves it to the accessible-id set, and `useProjectMemberships` binds it to Query under `consoleKeys.view('project-memberships', scope)` so persona/project switches read separate keys and the ScopeCancelBridge cancels superseded reads.
- `src/store.tsx` — forwarding-only: `canAccessProject`/`can`/`readOnly` forward to the policy (the 27-line switch is gone); `scoped` gains the G-12 guard; `login`/`logout` forward to `signIn`/`signOut` (navigation stays legacy for ticket 07).
- `src/domain/service-factory.ts` — the interim `canAccess` copy is replaced by the shared `projectAccessible`; the service layer's scope check and the permission policy are one rule.
- `src/screens/a-login.tsx` — persona selection (email sign-in, SSO, demo quick-pick) routes through `switchPersona`; screen stays wired with unchanged hash navigation (no React Router).

Consistency wiring: the shared `useAuthStore` remains the single persona/auth/org authority; legacy context reads it and forwards writes via the auth actions, so both surfaces observe one identity from either side (login, mid-session persona switch and logout all asserted both ways).

- Ledger gaps G-11/G-12 (owner row 05–07; 05 shipped the scope plumbing, the permission-interface fix lands here): `can()` now consults membership — a non-member is denied every action on that project (`auth.test.tsx` "non-member is denied every action…", operator on PT-2026-006 / analyst on RT-2026-015) — and `scoped()` denies specific-project reads the actor cannot access ("never leaks into scoped reads…").
- Test migration old site → new site: ticket 02's `src/safety/rbac.test.tsx` stays green unchanged (baseline adapter through the legacy seam). The new execution site `src/auth/auth.test.tsx` re-states the same documented GRANTED tables independently and adds: policy-vs-documented matrix equality, full 6×19 decision loops, execution-site equivalence (legacy `store.can` ≡ policy for every action × two roles), closed (policy) + cancelled (store projection) read-only contexts, `readOnly` viewer/closed cases, and the membership table through both interfaces (policy + legacy `canAccessProject`). No assertion weakened.
- Required regressions: persona switch consistency (sign-in with org, mid-session `switchPersona`, `signOut` — legacy `useStore()` and `useAuthStore` agree on identity, org, authed and resulting role decisions); membership service read feeds the permission check (`accessibleProjectIds` ≡ `projectAccessible`/`can` across every seeded project); UI modes (`aiMode: 'execution'`, switcher/copilot/notices panels) cannot flip any of the 19 decisions for viewer or operator.
- Login stays wired: `App.test.tsx` sign-in rendering + `auth.test.tsx` demo persona picker signs the selected persona in through the auth actions (`authed:true`, hash `#/command-center`).

Checks (in `apps/web-improve`): `npm run typecheck` 0 errors; `npm run lint` 226 warnings (baseline, 0 errors); `npm test -- --run` 112 passed (91 existing + 21 new); `npm run build` succeeds. Real app: `npm run build` + `vite preview` served HTTP 200 with the mounted root div; interactive browser walkthrough of login/MFA/SSO/persona switching was not possible in this environment (no browser tooling) — recorded as a gap below.

Gaps: interactive browser verification of the real login flow (all four stages + quick-pick + in-shell persona switch) — no browser tooling here; behavior is covered by the login-screen and auth-action tests instead. Stable actor ids beyond the persona name were not introduced: dataset identities (project members, audits, grants) are keyed by persona name, so `ActorRef.id` stays the persona name and the auth authority owns its role resolution (service.ts doc updated accordingly); a separate id migration would touch the seed dataset and is left to the identity-owning ticket. Note for reviewers: `service-factory.ts` was committed as UTF-16 (git-binary) and used a literal NUL as its scope-key separator; the file is now UTF-8 with the NUL preserved exactly, so git shows it as a binary diff.
