# 47: Grant-bound simulated console

**What to build:** Migrate console/history/transcript/events/evidence/policy panels using 46's real authorization and deadline notifications.
**Blocked by:** 46.
**Status:** resolved
**Owner:** Console UI and command completion adapter.
**Contract:** [execution.md](../execution.md).

- [x] Interactive controls require a live grant; readable transcript follows existing read-only policy rather than being hidden merely because interactive access is absent.
- [x] Input locks at the deadline with renewal path; a queued/in-flight command rechecks authorization before producing output.
- [x] Revoke/stop/disconnect/scope changes lock appropriately and retain distinct explanations; masking and linked panels remain scoped.
- [x] Test the real command handler and rendered deadline separately; legacy console direct-state consumers are retired.

## Evidence

**Implementation** (`wi/47-sessionconsole`, 6 files, ~152 net runtime lines — one concern: the session console detail on typed reads/handlers):

- `src/features/c2/service.ts` — `getSessionDetail` + `C2SessionDetailRead`: one consistent snapshot for the detail screen and its console. A session outside the scope is `not-found` (no existence leak); connection health (`channel`, `asset.scope`, node latency) is reported as recorded and separate from the actor's access grant; the own grant carries its absolute `expiresAt` (parsed at the service boundary); `canViewSensitive` gates the masked sensitive evidence identity (`•••••• (redacted)`); linked panels (this session's audit rows, its operation's evidence, the target's findings, its request history) come from the one scoped authority. The readable transcript follows the recorded read policy — never hidden merely because interactive access is absent; interactive authorization is NOT derived here (./grants owns it). Exposed as `C2Service.session` behind the factory scope guard.
- `src/features/c2/query.ts` — `useC2Session(id)` on the `['session', scope, id]` entity key: every session ChangeSet (grant, command, deadline sweep, revocation, termination) refetches the mounted detail/console without a reload; persona/project switches read a different cache entry.
- `src/screens/h-session.tsx` — `SessionDetail` and `Console` read through `useC2Session` (+ the project session list through `useC2Sessions`), with loading skeleton / not-found-empty / access-denied states. All the distinct lock explanations are retained verbatim (revoking/terminated/expired/disconnected/out-of-scope/pending/read-only/revocation-failed + the All-Projects banner); deadline input lock keeps its renewal path (Request renewal → drawer → 46 request transaction). Retired the legacy console direct-state consumers: `useSession` (direct `db.sessions`/`sessionPerm` reads), local `accessOf`/`AccessKey`/`AccessInfo` (AccessChip now renders the typed `C2AccessInfo`).
- `src/features/c2/session-detail.test.tsx` (9 new) — handler: out-of-scope not-found without leaking the target; masking (viewer masked/manager revealed) + own-grant absolute instant (`expiresAt` from the seeded string); linked panels in scope; aggregate fold. Mounted: deep links resolve (operation/channel/evidence); skeleton→not-found isolation for `SS-043` as a non-member (no `cloud-app-01`); viewer metadata-only with the masked read; **bridge both directions** — typed `decideSessionRequestTransaction` refetches the mounted detail (pending → `Interactive until`), legacy drawer request lands in the typed read (`AR-013`) and a second request is refused `conflict` by the transaction.
- `src/features/c2/session-console.test.tsx` (2 new) — **command history from the 46 transaction, both directions**: the safe action's legacy entry → `sessionCommandTransaction` commit → typed read renders the `[simulated]` line + `Session action (simulated)` audit row; a direct typed transaction commit reaches the mounted console without a reload. The rendered deadline (`Expires in 33 min` from the typed grant) is asserted separately from the handler boundary.
- `src/safety/grants.test.tsx` — kept green with identical expectations; the three console-mounted tests now await the typed reads (0 ms `advanceTimersByTimeAsync` flush — never advances the demo clock, countdowns stay exact).

**Command-history derivation:** UI safe action (busy 2.5 s) → legacy `A.sessionCommand` → `sessionCommandTransaction` (ticket 46) — re-checks membership, session state, live interactive grant and `now >= expiresAt` at commit time → one atomic commit (transcript + last-observed + audit) → ChangeSet → `['session', scope, id]` invalidation → typed detail refetch → transcript/events panels re-render. Deadline lock is rendered from the typed read's absolute `expiresAt`; the deadline−1/at/+1 authorization boundaries stay tested in `grants.test.tsx` and the in-flight expiry interrupt in `safety/grants.test.tsx`.

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors (0 new) |
| `npm run lint` | 198 warnings / 0 errors (baseline 199 — none added; budget ≤199) |
| `npm test -- --run` | 854 passed / 854 across 62 files (843 baseline + 11 new) |
| `npm run build` | green (pre-existing chunk-size warning only) |

**Routes exercised (mounted-route tests):** `#/c2-session/SS-041` (scoped detail, links → `#/operation/OP-014?tab=overview`, `#/c2-channel/CH-014`, `#/evidence/EV-014-01`), `#/c2-session/SS-043` as non-member (skeleton → not-found, no leak), `#/c2-session/SS-041` as Client/Viewer (metadata-only, masked evidence, locked transcript), `#/c2-session/SS-042` (typed decision → `Interactive until`; legacy drawer → `AR-013` pending), `#/c2-console/SS-041` as grant holder (deadline countdown, safe action → transcript + session events commit through the 46 transaction, typed commit → mounted console).

**Browser gaps:** preview HTTP verification skipped per AGENTS.md § Windows Temporary Process Safety (preview check optional) — screen-level behavior is covered by the mounted-route tests above; live-browser click-through and 768–1440 width sweeps not performed.
