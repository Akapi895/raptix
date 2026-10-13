# Execution contract

Read this once at the start of `/implement-spec`; each ticket inherits it. Read
spec.md for requirements and coverage.md when assigning a surface or retiring legacy code.

## Before creating worktrees

1. Verify `git ls-files -- apps/web-improve` from the repo root includes the app source.
   At the readiness review it was entirely untracked. Arrange a source-only baseline
   commit with the requester before using worktrees; committing is not part of this
   documentation correction. Preserve unrelated working-tree changes.
2. Resolve spec, tickets and `docs/agents/` pointers to paths available to all workers.
   The local tracker may stay in the main checkout with absolute context pointers;
   runtime source must exist in the integration base. Verify it in the first worktree.
3. Follow the root glossary and ADR rules. Record a Proposed frontend service/domain
   boundary ADR at the existing root ADR location before ticket 03/04 introduces it.
4. Use Node compatible with Vite 8 (at least 22.12) and npm for app tooling. This app
   is not in root npm workspaces: run scripts inside it, not via the other Web app's
   workspace alias. Ticket 01 owns dependency installation and app-local lockfile policy.

## Scheduler and diff budget

- The revised `issues/` contains executable leaves; the old 24 IDs are historical
  group labels in coverage.md, not schedulable tickets. Read explicit blockers;
  completion means verified code merged to the integration tip, not an agent's intent.
- Before code, inventory intended files and estimate runtime additions/deletions.
  Each leaf/PR must fit ≤400 runtime lines, ≤10 touched files and one concern.
  Mechanical moves/deletions are not assumed exempt. If it does not fit, split that
  leaf into separate tracker files, transfer its outgoing blockers to a completion
  leaf, and validate the graph before starting. Never silently exceed the cap.
- Keep ticket-sized PRs independently green. An integration branch may accumulate
  them, but do not open a single roadmap-sized PR without explicit owner approval.
- Each ticket declares an owner. Parallel workers edit their feature-local files.
  One integrator applies route registry and provider composition changes serially;
  append-only registries can still conflict. Declare additional shared-file writes
  before dispatch and serialize overlapping writers or move the change to its owner.
- Legacy store, service factory, contracts, manifest and shared styles are not
  unrestricted feature-worker surfaces. Use established transactions/contracts;
  integration of compatibility forwarding is serialized by the integrator.

## One data authority during migration

- Ticket 04 owns one seeded database, snapshots, atomic transactions and subscriptions.
  Both legacy `db`/actions and migrated services use this authority, never a second seed.
  Move only the data ownership plumbing in that ticket; feature handlers follow later.
- A legacy action delegates to the new handler once that handler owns its behavior;
  until then its existing mutation commits through the shared transaction bridge.
  New reads use typed service contracts; components never inspect the database directly.
- Every request/mutation captures actor and project explicitly. Persona/project changes
  must not retarget an in-flight mutation. Query keys include authorization scope and
  project; cancel obsolete reads and prevent late responses from restoring old visibility.
- A committed mutation publishes affected entity/project identities. The Query bridge
  invalidates/refetches matching keys; the legacy subscriber receives the same snapshot.
  Scope invalidation and emergency stop update related entities atomically.
- Demo reset cancels owned timers/requests, resets the single dataset and clears related
  caches/UI state. Test reset twice to catch stale callbacks and duplicate subscriptions.
- Factory context provides the real handlers with clock, actor and transactional access.
  Test clocks replace time, not the handler enforcing the rule. Dispose listeners/timers
  on reset/unmount; deadline events continue without the relevant screen being open.
- The mock clock retains the dataset's demo-date/initial-time anchor and advances elapsed
  time as absolute instants, including date rollover. Normalize seeded expiry strings at
  the service boundary and apply project timezone for display/window checks; do not mix
  host wall-clock dates with the export's fixed demo date. Reset restores that anchor.
- Bridge acceptance: mutate from new services and observe legacy screens, then mutate
  through legacy actions and observe new Query consumers. Include approval/notice,
  operation/session and project-switch/reset examples as their features migrate.

## Baseline versus missing enforcement

| Requirement | Baseline site/evidence | Target owner |
|---|---|---|
| 1: preflight | Store helper/actions; time-window check is a pass placeholder | 26 (real time/required-plan/approval gates), 39 (approval expiry) |
| 2: emergency stop | Store state machine and delayed outcomes | 28; UI integration 29, 45–47 |
| 3: four-eyes | Mixed store and UI checks; not every action rejects self-approval | 21 projects, 22 closure, 36 reports, 39 plans, 46 access, 53 playbooks |
| 4: facets | Real `toolFacets` helper plus trace UI | 41 |
| 5: AI proposals | Chat/proposal and finding UI paths | 32, 38, 40 |
| 6: isolation | Project filtering, guards and scoped screens | 05–07 plus every feature's scoped reads |
| 7: grants | C2 `useGrantWatch` on mount/every 15s; actions remove grants | 46 deadline enforcement/sweep, 47 console lock |
| 8: closure | Helper + CloseTab checks; actions alone are insufficient | 22 |
| a: ROE invalidation | Store editScope/addAssets invalidate at submission | 21; asset path 51 |
| b: 24h plans | Expiry field/copy exists; start/execute do not enforce deadline | 39, integrated by 40 |

Ticket 02 characterizes observable working behavior and records uncovered target cases
with their owners; it does not ship disabled tests or claim gaps already pass. Add new
regressions in the owning ticket, observe them fail, then enforce the target. Preserve
baseline expectations through adapters as execution sites move. Test each preflight
failure, role/context denial and relevant deadline/outcome boundary; ten requirements
do not mean ten test cases. Pure helper tests and focused accessible-widget tests are valid.

Scope revisions invalidate at submission, not approval. Plan approvals expire exactly
24h after the independent decision. Grant commands are denied at `now >= expiresAt`,
including completion of in-flight commands; the 15-second cleanup sweep is not a grace
period. Expiry tests run without the console mounted and use absolute fake-clock dates.

## Per-ticket completion

- Run `npm run typecheck`, `npm run lint`, `npm test -- --run`, and `npm run build`
  in the app after tooling exists, plus the focused feature tests. Ticket 01 records
  any pre-existing diagnostics before defining their owning migration tickets; new
  diagnostics are not allowed. Final verification requires zero outstanding diagnostics.
- Exercise the real app route with success and refusal/error outcomes. Record commands,
  route/persona/project and observed behavior in the ticket. Unit tests alone do not
  prove wiring. Report inaccessible browser verification as a gap, not a pass.
- Each feature owns loading/empty/error states, forms' validation/dirty/submit behavior,
  list search/filter/pagination, confirmation/reasons for destructive actions, keyboard
  access and light/dark checks at 768/1024/1280/1440 widths. Later audits verify coverage;
  they are not a postponed implementation wave for all these behaviors.
- Keep related baseline tests green; add target regressions at the true execution site.
  Review Standards and Spec against the ticket's base. Remove retired definitions in
  bounded batches while leaving compatibility wrappers for remaining callers.
- Update the ticket only after evidence exists. Added split leaves also inherit these
  checks. The final route inventory compares keys, entity IDs, tabs/aliases and direct
  refresh behavior, not just a route count.
