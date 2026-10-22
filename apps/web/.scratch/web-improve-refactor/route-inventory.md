# Route inventory (ticket 07 — migration contract for all later feature tickets)

> Cập nhật 2026-10-22: `command-center` không còn là route key. Địa chỉ cũ được `router/aliases.ts` chuyển thành `overview` (URL được thay bằng route chuẩn). Nội dung dưới đây giữ nguyên như lịch sử ticket 07.

Recorded before the router migration landed. **53 route keys** exist in the
source (`src/screens/*/routes` records, aggregated by the old `App.tsx`
spread). Every key resolves through the new React Router registry
(`src/router/registry.tsx` — `MANIFEST`); `command-center` is the home page.
There is **no `dashboard` route key** — the shell sidebar's
`match: ['command-center', 'dashboard', 'tasks']` array is *nav highlighting*,
not a route key (`src/shell.tsx`), and no dashboard alias was invented.

## Canonical URL format (unchanged from the legacy app)

```
#/<page>[/<entity-id>][?tab=<tab>]
```

- Kept hash-based on purpose: survives base-path deployments (vite `base` may
  be a public sub-path via `FIGMA_PUBLIC_URL`) and keeps every pre-migration
  deep link working verbatim.
- `entity-id` is URI-encoded (legacy `encodeURIComponent` behaviour).
- `?tab=` is the only search parameter the router models; screens may read
  extra raw query params from the hash (see "Known raw reads/writes").
- The React Router data router (`createHashRouter`, `src/router/host.tsx` +
  `src/App.tsx`) is the **single location writer**; the store's `route`
  (`{ page, id?, tab? }`) is a projection of the router location.
  `router.navigate` receives the path form (`/page/id?tab=x`,
  `src/router/history.ts#toHref`); legacy `#/...` strings are the
  address-bar/storage form (`toHash`).

## The 53 keys

| # | Key | Screen record | Entity-ID param | Tab aliases (`?tab=`) |
|---|-----|---------------|-----------------|------------------------|
| 1 | `login` | `a.tsx` | — | — |
| 2 | `forbidden` | `a.tsx` | optional (role rule id) | — |
| 3 | `notfound` | `a.tsx` | — | — (also the fallback for unknown keys) |
| 4 | `error` | `a.tsx` | — | — |
| 5 | `offline` | `a.tsx` | — | — |
| 6 | `session-expired` | `a.tsx` | — | — |
| 7 | `states` | `a.tsx` | — | — |
| 8 | `command-center` | `a.tsx` | — | — (home) |
| 9 | `tasks` | `a.tsx` | — | — |
| 10 | `projects` | `b.tsx` | — | — |
| 11 | `project-new` | `b.tsx` | — | — |
| 12 | `project` | `b.tsx` | project ID | `overview, scope, operations, plans, findings, reports, objectives, activity, team, sessions, evidence, audit, close`; legacy aliases resolved by the screen (`b-detail.tsx` TAB_ALIAS): `closure→close, closeout→close, members→team, approvals→team, ai-plans→plans, c2→sessions, audit-log→audit, roe→scope` |
| 13 | `operations` | `c.tsx` | — | — |
| 14 | `operation-new` | `c.tsx` | — | — |
| 15 | `preflight` | `c.tsx` | operation ID | — |
| 16 | `operation-schedule` | `c.tsx` | operation ID | — |
| 17 | `operation` | `c.tsx` | operation ID | `overview, live, agents, timeline, graph, results` |
| 18 | `agents` | `d-agents.tsx` | — | `list` (default), `pool`, `groups`, `health` |
| 19 | `agent` | `d-agents.tsx` | agent ID | `overview` default; screen reads `route.tab` directly |
| 20 | `assets` | `d-assets.tsx` | — | `scope-map` renders the scope viewer instead of the list |
| 21 | `asset-new` | `d-assets.tsx` | — | `manual` (default), `bulk`, `disc` |
| 22 | `asset-scope` | `d-assets.tsx` | — | — |
| 23 | `asset` | `d-assets.tsx` | asset ID | `overview` default; `edit` is treated as `overview` |
| 24 | `playbooks` | `d-library.tsx` | — | `playbooks` (default), `profiles` |
| 25 | `playbook` | `d-library.tsx` | playbook ID | — |
| 26 | `technique` | `d-library.tsx` | technique ID | — |
| 27 | `playbook-review` | `d-library.tsx` | revision ID | — |
| 28 | `analysis` | `e-analysis.tsx` | operation ID | `overview` default; screen reads `route.tab` directly |
| 29 | `findings` | `e-findings.tsx` | — | `all` (default), `confirmed`, `review`, `ai`, `drafts`, `remediation` |
| 30 | `finding-new` | `e-findings.tsx` | — | — |
| 31 | `finding` | `e-findings.tsx` | finding ID | `overview` default; screen reads `route.tab` directly |
| 32 | `evidence` | `e-findings.tsx` | evidence ID | — |
| 33 | `evidence-inspector` | `e-findings.tsx` | evidence ID | — |
| 34 | `reports` | `f.tsx` | — | — |
| 35 | `report-new` | `f.tsx` | — | — |
| 36 | `report` | `f.tsx` | report ID | `overview` default; screen reads `route.tab` directly |
| 37 | `report-preview` | `f.tsx` | report ID | — |
| 38 | `report-review` | `f.tsx` | report ID | — |
| 39 | `settings` | `f.tsx` | — | `org` (default), `users`, `integrations`, `policies`, `retention`, `templates`, `detection`, `audit`, `notifications`, `security` |
| 40 | `ai-operator` | `g.tsx` | optional conversation ID | — |
| 41 | `ai-plan` | `g.tsx` | plan ID | `builder, overview, steps, branches, assets, risk, refs, history`; `step-<id>` deep links a step |
| 42 | `ai-plan-review` | `g.tsx` | plan ID | — |
| 43 | `ai-plan-compare` | `g.tsx` | plan ID | — |
| 44 | `ai-trace` | `g.tsx` | optional tool-event ID | — (event deep link uses raw `?event=` query, read by `g-trace.tsx` hashParam) |
| 45 | `ai-history` | `g.tsx` | — | — |
| 46 | `ai-fanout` | `g.tsx` | branch-group ID | `graph` (default) / `table` |
| 47 | `ai-branch` | `g.tsx` | branch ID | — |
| 48 | `c2` | `h.tsx` | — | `infrastructure, channels, sessions, requests, audit` |
| 49 | `c2-channel` | `h.tsx` | channel ID | — |
| 50 | `c2-session` | `h.tsx` | session ID | — |
| 51 | `c2-console` | `h.tsx` | session ID | — |
| 52 | `scenarios` | `scenarios.tsx` | — | — (renders outside the shell, public) |
| 53 | `workspaces` | `scenarios.tsx` | — | — (renders outside the shell, public) |

Screens that render **outside the console shell** even when authenticated:
`scenarios`, `workspaces` (legacy `App.tsx` special case, now
`OUTSIDE_SHELL` in `src/router/history.ts`). `login` renders in place for any
protected URL when unauthenticated — the requested URL is the safe return
destination and is preserved verbatim after sign-in. Unauthenticated deep
links no longer auto-authenticate: the auth store (ticket 06) is the single
authorization authority.

## Navigation authority (post-migration)

- One data router per `App` mount (`createHashRouter`, splat route,
  `errorElement` = root boundary); `RouteHost` resolves
  page → component via the registry manifest.
- Single location writer: `store.navRaw` → `router.navigate(toHref(route))`.
  There is deliberately **no** second `window.addEventListener('hashchange')`;
  the store subscribes to the router (`router.subscribe`) instead. The
  ledger-recorded `setPid` hash-clobber (hash written inside a `setRoute`
  updater) is fixed: the redirect is computed from the committed route
  (`routeRef`) and written once through `navRaw`.
- Dirty navigation: in-app `go()` pre-guards through the legacy
  unsaved-changes modal; popstate/URL-edit traversals are held by a
  `useBlocker` (`DirtyNavBlocker`) that feeds the same modal.
- Lazy loading: screen modules `b`–`h` + `scenarios` are dynamic-import
  chunks; the auth/system slice `a` stays in the main bundle so the login
  screen renders without a round-trip.

## How feature tickets add a route (append-only)

1. Export the key from your feature screen record (`src/screens/<x>.tsx`
   `routes`).
2. Append one `key: slice` line to `MANIFEST` in `src/router/registry.tsx`
   (shared file owned by 07 + integrator; the integrator serializes
   overlapping writes per `execution.md`).
3. Append a row to the table above (part of the same shared write).
4. Update `.scratch/web-improve-refactor/issues/` acceptance notes if the key
   introduces new guard/tab behavior.

## Known raw reads/writes outside the router (owned by feature tickets 08+/14+)

These pre-date the router and kept working because the URL format was
unchanged, but they bypassed the single-writer rule. The list is now empty —
every screen navigates through `store.go()`/the router:

- `src/screens/f-report.tsx` `hardGo` — retired in ticket 61e (the raw
  router-less fallback write and the duplicated seam logic are gone; the
  report submit/preview/resubmit/return flows navigate through the store's
  guarded `go`).
- `src/screens/g-common.tsx` `useTraceLink` — retired in ticket 61e (writes
  the `#/ai-trace/<encoded-id>` deep link through the guarded `go`).
- `src/screens/g-fanout.tsx` — converted by the fanout/branches tickets.
- `src/screens/g-trace.tsx` — converted by tickets 41/42 (route-path id read,
  `?event=` duplicate retired).

The only remaining `window.location.hash` write is inside the store's
`navRaw` fallback for router-less mounts (tests), which is part of the
single-writer seam itself. A grep assertion in `src/router/routes.test.tsx`
keeps every other module clean.
