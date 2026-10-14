# 45: C2 infrastructure, channels and overview

**What to build:** Migrate the five-tab C2 shell, infrastructure/channel/session reads and channel detail; request/grant mutations remain bridged until 46.
**Blocked by:** 13, 28.
**Status:** resolved
**Owner:** C2 read models and overview/channel surfaces.
**Contract:** [execution.md](../execution.md).

- [x] Infrastructure/channels/sessions/requests/audit tabs resolve directly, with scoped search/filter/pagination and loading/empty/error states.
- [x] Channel/session links preserve identity; connection health is distinct from access permission.
- [x] Ticket 28's actual stop outcomes update sessions in the overview, including failure/unknown without fake termination.
- [x] Legacy grant requests still work through the bridge; no separate C2 data authority exists.

## Evidence

Implementation (branch `wi/45-c2overview`): the five-tab shell in
`src/screens/h.tsx` reads through a feature-local read model
(`src/features/c2/service.ts` + `query.ts`, wired as
`services.c2(actor, project)` in the factory) — the overview KPI band,
infrastructure table/drawer, channels tab, channel detail, sessions tab,
requests tab and audit views all consume typed reads over the one authority;
no component inspects `db` for these reads anymore (the store projection is
used only for the live stop banner and the bridged renewal lookup, which stay
until 46). Request/grant mutations and `useGrantWatch` remain on the legacy
bridge per the ticket scope.

- Scoping: a non-member specific-project read is `not-found` with no
  existence leak (overview + channel detail); the aggregate view folds
  accessible projects (pool agents count as connected inventory, unassigned
  nodes and workspace audit rows visible) — `getOverview denies a non-member
  …`, `a non-member specific-project read is refused…`.
- Derived state: session rows carry the recorded connection state separately
  from the actor's access grant (`Connected` + `Read-only` on one row);
  channel detail derives sessions/agents/operations from canonical session
  data; access chips derive only from recorded grants/requests (no expiry
  evaluation — ticket 46 owns the deadline lifecycle).
- Masking: the channel callback configuration is masked by default and
  reveals only for `viewSensitive` holders (policy-derived, agents-detail
  pattern); roles without it see the mask with no control.
- Links: session rows resolve `#/c2-session/<id>`, channel rows
  `#/c2-channel/<id>`; channel detail tabs list agents/operations with
  identity links. Deep link `#/c2-channel/CH-015` for a non-member renders
  the not-found state (isolation preserved; note `setPid` from a detail
  route redirects to the parent list, unchanged store behavior).
- Stop outcomes (ticket 28 machine): request → banner + sessions still
  connected; failure/unknown outcomes never fake a termination (rows stay
  `Connected`); acknowledgement → linked sessions `Revoking`; finalize →
  `Terminated`, with the out-of-scope session untouched.
- Bridge: a legacy grant decision (`A.decideSessionRequest`) and a real
  drawer submission (`A.requestSessionAccess`) update the mounted session
  rows/requests through the ChangeSet invalidation without a reload; the
  typed estop transactions (the exact handlers the legacy action drives)
  update the overview the same way.
- Loading/empty/error: page-level skeleton + retry on overview failure,
  per-tab skeletons/empty states/error retries for sessions/requests/audit;
  keyboard/table interaction and filters preserved from the legacy shell
  (search, connection/type selects, More-filters popover, pagers).

Checks (`npm run typecheck`, `npm run lint`, `npm test -- --run`,
`npm run build` in `apps/web-improve`): typecheck 0 errors; lint 202
warnings — exactly the pre-existing baseline, 0 errors; tests 790 passed
(769 baseline + 21 new in `src/features/c2/service.test.tsx`); production
build succeeds. One unrelated pre-existing flake observed once
(`features/operations/write.test.tsx` under full parallel load) — passes in
isolation and on re-run; operations code untouched by this ticket.

Budget: 6 files touched (≤10), one concern; net runtime ≈377 lines
(c2/service.ts 243 + c2/query.ts 88 + factory wiring 6 + h.tsx net +40,
against 102 deleted legacy read lines) ≤400.

Gaps: browser walkthrough not performed (preview HTTP check skipped per
AGENTS.md § Windows Temporary Process Safety — optional, recorded as a gap);
screen-level behavior is covered by the mounted-route tests above, but the
route-registry round-trip in a real browser is unverified by this ticket.
