# 70: Initial-load architecture — close the 72 KB gzip gap

**What to build:** Reduce the initial authenticated-load closure below the 200 KB
gzip budget. Ticket 68 measured the initial closure at **272,093 gz bytes
(index 166,405 + ui 94,125 + css 11,563; 265.7 KiB)** at commit `168fecc`
(`npm run build -- --manifest`, closure via [wi-68-budget.mjs]; pre-refactor
baseline was a 1.4 MB single bundle per ticket 04 evidence). That is a **72 KB
(72,093 gz bytes) gap** against the <200 KB budget, so ticket 68 criterion 1
remains open. This ticket owns the structural fix; no speculative memoization.
**Blocks:** 68 criterion 1 (and therefore 69 final acceptance).
**Status:** complete — fresh closure **198,307 gz bytes < 200,000 (PASS)** at the integration merge of branch `wi/70-impl` (commits 86fd3de, ba37dd2, a7d8062, 8433241); see [68](68-performance-budget.md) criterion 1.
**Owner:** Build/performance architecture.

## Where the bytes are

The initial closure is exactly three assets: the entry chunk (`index-*.js`,
568,725 raw), the shared `ui` vendor chunk (`ui-*.js`, 358,808 raw) and the
global CSS. The eight lazy route chunks (b/c/d/e/f/g/h, demo pages) are clean —
they statically import only the entry, the ui vendor chunk, small icon chunks
and the shared `service` module, and never reach another route chunk. The gap is
inside the entry + vendor pair itself, not route splitting.

## Bounded options (to be measured, not all applied)

1. **Entry slimming via lazy states gallery / demo surfaces.** The statically
   imported auth/system group (a) includes the states gallery and demo pages
   support. Verify whether the states-gallery and demo-guidance modules can move
   behind dynamic imports without breaking the system route group.
2. **Service-registry splitting vs off-page sweep invariants.** The entry
   statically imports the service factory, which wires every feature handler
   (estop scheduling, grant lifecycle sweep, demo runtime) into one registry.
   Splitting the registry by feature would cut the entry, but deadline sweeps
   and demo reset intentionally run off-page — any split must preserve those
   off-page invariants (families 2, 7, 10 of the invariant census) before it
   ships. Do not trade a budget number for a correctness regression.
3. **Vendor strategy.** `ui` (94,125 gz) bundles the icon set + chart/UI kit.
   Bounded options: per-icon chunk tightening, chart lazy-loading, and checking
   whether locale/launcher data can be dropped from the bundle. Measure each
   against the same manifest-closure method before and after.
4. **CSS scope.** 11,563 gz is small; only touch it if the above lands short.

**Evidence required to close:** fresh `--manifest` build, wi-68-budget.mjs
closure under 200,000 gz bytes, import-graph proof unchanged (lazy chunks still
pull only entry/vendor/shared service), and the ten invariant families still
green at their enforcement sites.

## What landed (evidence)

1. **Eager chains broken.** Copilot drawer lazy-mounted via
   `features/copilot/lazy.tsx` (86fd3de) — `g-common`/`g-fanout` left the entry;
   `MyTasks` split into `screens/a-tasks.tsx` and lazy with `StatesGallery`
   (ba37dd2); the shell's demo walkthrough panel lazy-mounted (a78062 → a7d8062),
   taking `screens/demo/guides.ts` out of the entry.
2. **Service-registry lazy-binding (8433241).** Non-sweep feature handlers now
   load on first call through a memoized `lazyService` proxy in
   `domain/service-factory.ts` (typed call surface unchanged — handlers were
   already async; the seed dataset stays eager for sync reads). Kept eager for
   the off-page sweep invariants: estop, `c2/grants`, `operations/preflight`,
   `demo/runtime`, identity/auth, chat. The pure `sessionPermOf` rule moved to
   `features/c2/session-perm.ts` so navigation search no longer drags
   `c2/service` into the entry. `Dashboard` (command-center) became a lazy
   route component like the other slices.
3. **Closure:** 272,171 → **198,307 gz** (index 139,064 + data 13,895 + css
   11,563 + jsx-runtime 10,191 + keys 9,929 + console 8,616 + service 3,393 +
   clock/policy/demo-clock 1,656). Attribution snapshots:
   `C:\Users\tuanp\AppData\Local\Temp\opencode\wi-70-after-entry.txt` / `wi-70-after-ui.txt`.
4. **Invariants:** route-manifest gate EQUAL (53 keys, no aliases — the gate's
   parser now skips the React.lazy `default:` wrapper key); focused suites on
   the changed surface: services/factory, estop, c2 (grants/service/session),
   operations deadline+preflight, demo runtime, copilot, shell, host, a11y
   audit, App — 165/165 in the worktree, 64/64 re-run on the integration tree
   after merge; typecheck 0, `lint --max-warnings=0` 0.
