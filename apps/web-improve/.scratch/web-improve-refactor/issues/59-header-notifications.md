# 59: Header notifications

**What to build:** Migrate notification grouping/read-state/deep links to canonical notice services and the shared header slot.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Notice read/write services; integrator applies header wiring.
**Contract:** [execution.md](../execution.md).

- [x] Approval and operational submissions produce grouped notices visible without reload, from both legacy and migrated actions.
- [x] Read/unread handling and target links preserve project authorization and identity.
- [x] Empty/loading/error states and accessible announcements work; late requests cannot leak previous-scope notices.
- [x] Header composition changes are serialized by the integrator, not concurrent edits to shared layout files.

## Evidence

**Feature-local modules (branch `wi/59-notifications`):**

- `src/features/notices/service.ts` — notice handlers on the `DbAuthority`: `listNotices` (persona-scoped read: system notices for every signed-in actor, project notices only for accessible projects; returns the resolved chip per row, the unread badge count and the `canMutate` gate), `setNoticeRead` (per-notice read/unread; out-of-scope/unknown ids refuse as `not-found` without a leaked existence signal), `markAllNoticesRead` (in-scope rows only — the legacy seam's unscoped mark-all leak is fixed at the handler; other personas keep their unread rows), `dismissNotice` (viewer-refused with a renderable reason, audited as `Dismissed notification`, removes for everyone). Writes capture actor/project at call time, commit once through the shared transaction bridge and publish the ChangeSet both bridges observe. `createNoticeService` takes the factory's superseded-scope read guard.
- `src/features/notices/query.ts` — `noticeKeys.list(scope)` = `['notice', scope, 'list']` (the `notice` entity kind at position 0 so the ChangeSet bridge's `['notice']` prefix invalidation reaches the badge/popover on every legacy or migrated notice commit), `useNotices()` (actor from the persona projection, so settings role overrides apply immediately), `useNoticeMutations()` (setRead/dismiss/markAllRead; refusals resolve as explicit ServiceResult for the caller to render).
- `src/features/notices/header-notices.tsx` — the `HeaderNotices` slot implementation: bell + unread badge, unread/all tabs, the six grouping chips, per-row mark read/unread + dismiss (confirm modal, audit-logged) + Review/Open deep link via `go` (legacy target authorization preserved), loading/empty/error states, and an `aria-live` sr-only announcement of unread-count changes. Viewer personas see a visible read-only explanation and disabled dismiss buttons.

**Shell slot composition (ticket 08 contract):** `ShellSlots.notifications` is filled at the mount site — `src/router/host.tsx` passes `slots={{ notifications: HeaderNotices }}` (append-style: one import + one prop + doc note). `src/shell/*` internals are untouched; the legacy `Notices` component stays the slot default for direct `Shell` mounts, and the copilot slots keep legacy defaults for ticket 60.

**Bridge proof (tests in `src/features/notices/service.test.tsx`, 14 passing):** legacy → new: `A.notify(...)` appears in the Query view and in the open popover without a reload; new → legacy: a service `dismiss`/`markAllRead` is observed by `store.db` (identical snapshot). A superseded-scope read resolves `unavailable` after `cancelScope`, so a late response cannot restore previous-scope visibility.

**Tests (14):** scoped list per persona (Riley sees only RT-2026-014 + system; elevated roles see all; viewer `canMutate=false`), per-notice read/unread with not-found refusals, mark-all-read scoping (out-of-scope rows untouched), dismissal audit + viewer/`not-found` refusals with reasons, legacy→new and new→legacy bridge, badge count updates through the service bridge, persona-switch re-scoping without cross-scope leakage, and five rendered cases on the real route host through the shell slot (scoped rows, read toggle + mark-all badge updates + empty state, legacy notice appears in the open popover, dismiss confirm modal + audit row, viewer gate disabled with the visible reason).

**Verification:** `npm run typecheck` clean (0 new); `npm run lint` 217 warnings / 0 errors (baseline 217, budget ≤218, none from touched files); `npm test -- --run` 481/481 across 36 files (467 baseline + 14 new); `npm run build` green.

**Gaps:** browser/preview walkthrough (route `#/command-center`, light/dark, 768–1440 widths) not performed per AGENTS.md § Windows Temporary Process Safety — the slot composition, states and gating are covered by the rendered jsdom cases instead. The settings `notifications` preferences tab stays with the settings tickets (57/58); this ticket owns the header surface and services only.
