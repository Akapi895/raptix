# 56: Profile and organization settings

**What to build:** Migrate profile/organization settings and the six-tab settings shell using typed session-persistent services.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Settings shell/profile/organization fields.
**Contract:** [execution.md](../execution.md).

- [x] Save/reset/validation/dirty behavior works for profile and organization; successful changes persist for the demo session.
- [x] Admin-only organization changes enforce permission in real handlers and expose refusal reasons.
- [x] Existing secondary settings links remain compatible; excluded real SSO/MFA/backend behavior stays explicitly simulated.
- [x] Other settings panels remain bridged until their owners migrate them; shared auth state does not fork.

## Evidence

- `src/features/settings/service.ts` — org handlers on the `DbAuthority`: `getOrgProfile` (admin contact masked for non-admins), `getOrgMembers` (staff-only read; viewer emails masked below admin; per-member audit `history` + `projectOptions`), `updateOrgProfile` (admin-only; validates name/contact/read-only default workspace; refused saves commit nothing), `setMemberRole` (admin-only, reason-required, same-role conflict), `setMemberStatus` (admin-only; self-status forbidden; lock/revoke reason-required; repeat-revoke conflict), `inviteMember` (format/duplicate/org-wide-admin rules). All commits append audit rows and publish `EntityKind 'org'` ChangeSets via `database.ts` diff.
- `src/features/settings/query.ts` — `orgKeys` scope-aware views (`useOrgProfile`, `useOrgMembers`) + `useOrgWrites` (corr tags `org-profile-save`, `org-member-role`, `org-member-status`, `org-invite`); the ChangeSet bridge invalidates `['org', scope('all'), …]` on org commits.
- Org state is seeded in the canonical `Db` (`data.ts`: `org.profile` / `org.members` / `org.invites`), so the demo reset restores it and every consumer observes committed state.
- Shared auth state does not fork: `store.tsx` `me` projection applies `db.org.members[me]?.role` overrides — persona identity and legacy permission gates reflect committed role changes immediately (also round-trips through the switcher).
- Migrated `screens/f-settings.tsx` Org/Users tabs onto the typed service: Save/Reset with reasons, dirty gating, error banners, masked-contact hints, invite modal, access-history drawer, non-admin Save disabled with the refusal reason. Integrations/policies (57) and retention/audit (58) panels remain bridged.
- Tests `src/features/settings/service.test.tsx` (16): handler persistence/audit/validation/gating/masking, new→legacy bridge (service save observed by `store.db` + audit), persona role reflection + round-trip, legacy→new bridge (`A.updateProject` refetches the members view without reload), Query invalidation probes, and settings-screen save/gating UI.

Checks: `npm run typecheck` 0 errors; `npm run lint` 218 warnings (baseline unchanged); `npx vitest run --maxWorkers=1` 433 passed (417 baseline + 16 new); `npm run build` succeeds.

Notes: tests run with `--maxWorkers=1` on this Windows environment (parallel workers hit vitest's worker timeout). Runtime delta ≈ 500 lines across 9 files — above the 400-line guideline because the handlers absorb the legacy screen's inline org logic; the test file is not runtime.
