# 46: Session requests and exact grant deadlines

**What to build:** Migrate session detail/request/approve/return/reject/revoke with real independent review and deadline authorization. Move expiry scheduling out of mounted C2 screens into canonical service lifecycle.
**Blocked by:** 45.
**Status:** resolved
**Owner:** Session access policy, grant handlers and expiry lifecycle.
**Contract:** [execution.md](../execution.md).

- [x] Real request/decision actions enforce actor/project/role/self-review and required reasons; grant is per user/session.
- [x] Authorization denies interactive commands at `now >= expiresAt`, even with no C2 page mounted or before the next 15s sweep.
- [x] Deadline notification updates access/countdown; sweep removes expired records/audits without a grace period or terminating the connected session.
- [x] Tests cover deadline−1/deadline/deadline+1, revoke/stop/reset and repeated mounting; bridged legacy commands use the same authorization.

## Evidence

**Implementation** (`wi/46-grants`, 10 files, ~344 net runtime lines — one concern: the grant lifecycle):

- `src/features/c2/grants.ts` (new) — the feature-local transactions and lifecycle:
  - `requestSessionAccessTransaction` — membership is the existence boundary (`not-found`, no leak), role needs the `interactive` policy action, reason ≥ 20 chars (`validation`), one pending request per user/session is a `conflict`; one atomic commit (request + Pending audit + approver notice).
  - `decideSessionRequestTransaction` — self-review refused (`forbidden`, four-eyes), `approveAccess` role required, decision note required, only `pending` decisions allowed (`conflict`); approval binds ONE per-user grant on that session (replaces that user's prior grant, leaves others untouched) with expiry `now + minutes` as an absolute instant; duration bounded 1–120 min; atomic commit (request + grant + transcript + Success audit + notice).
  - `revokeGrantTransaction` — own grant always revocable, another user's needs `approveAccess`, reason required, no-grant is a `conflict`; the session stays connected (revocation ≠ termination).
  - `sessionCommandTransaction` — **the handler is the watch enforcement**: requires a live interactive grant on a connected session and denies at `now >= expiresAt` (absolute instants via the injected clock), before any sweep and with no console mounted; success commits transcript/last-observed/audit atomically.
  - `sweepExpiredGrants` — removes grants at `now >= expiresAt` (no grace period), expires their approved requests, records the transcript line + Warning audit, keeps the session connected; idempotent (commits nothing when nothing is due).
  - `expireGrantTransaction` — the immediate single-grant expiry behind the console's "Demo: simulate expiry" control and the in-flight interrupt.
  - `createGrantLifecycle` — registered ONCE by the factory: a recurring 15 s sweep plus an exact scheduler callback per live grant, re-armed on session-grant changes and after a demo reset (`corr 'reset'`).
- `src/domain/service-factory.ts` — registers `createGrantLifecycle(authority, clock, scheduler)`; disposed on `dispose()`.
- `src/store.tsx` — the legacy C2 entries now delegate to the transactions (`requestSessionAccess` → `{ok, id?|error}`, `decideSessionRequest`/`revokeGrant`/`sessionCommand` → `Res`, `expireGrant` → the immediate expiry); StoreProvider advances the service clock in lockstep with the demo wall clock (15 s interval, disposed on unmount) so deadlines fire with no C2 page mounted and stay deterministic under the test clock. Termination stays with the legacy bridge (ticket 28/45 machine).
- `src/screens/h-session.tsx` — `useGrantWatch` is now a compatibility adapter: it no longer expires anything (the lifecycle owns enforcement); it keeps the 15 s countdown cadence and warns the holder when the lifecycle just expired their grant. Drawer/revoke/console surfaces bridge handler refusals to toasts; the in-flight command interrupt now comes from the handler's own re-check.
- `src/screens/h.tsx` / `src/screens/a-dashboard.tsx` — decision surfaces surface handler refusals (`toast(res.error)`); the inbox's `decide` helper already handled `Res`.
- `src/features/c2/service.ts` / `query.ts` — doc headers updated (read model unchanged; mutations live in `./grants`).

**Grant lifecycle map:** request (role/membership/reason-gated, per user/session) → decision (independent approver, note required, pending-only) → grant (per user/session, absolute `expiresAt`, never project-wide) → use (command handler re-checks state + deadline on every commit) → revoke (self any time; others with `approveAccess`; reason required) | expiry (exact deadline callback + 15 s backstop sweep; no grace period; request → `expired`; session stays connected) → re-arm on demo reset.

**Required tests** — `src/features/c2/grants.test.tsx` (11 new): request gated (viewer/analyst roles, non-member `not-found` without a leak, short reason, duplicate conflict; refusals commit nothing); decision gated (self-review, operator role, short note, decided request) + per-user/session grant binding with absolute expiry; deadline−1 allowed / deadline denied (`forbidden`, "expired") / deadline+1 denied with no partial commits; sweep boundary at exactly `expiresAt` (request expired, session still connected, idempotent); revocation (reason-required, self-allowed, foreign needs approver, repeat is a conflict); lifecycle expiry with no screen mounted + reset re-arm + unmount/remount exactly once; bridge both directions (typed decision → mounted legacy sessions view; legacy `A.requestSessionAccess` → typed requests read). Deadline tests run without the console mounted and use absolute instants from the service clock.

**Baseline** — `src/safety/grants.test.tsx` kept green **unmodified** (6 tests) via the compatibility hook; 45's two legacy-bridge tests in `src/features/c2/service.test.tsx` re-pointed to the typed decision/role-correct requester (they had relied on the unenforced bridge).

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors (0 new) |
| `npm run lint` | 199 warnings / 0 errors (budget ≤202; baseline 202 — none added) |
| `npm test -- --run` | 833 passed / 833 across 59 files (822 baseline + 11 new in `src/features/c2/grants.test.tsx`) |
| `npm run build` | green (pre-existing chunk-size warning only) |

**Routes exercised (mounted-route tests):** `#/c2?tab=sessions` (typed decision → legacy rows refetch, `Interactive until` appears, `Pending request` clears), `#/c2?tab=sessions` as operator (legacy drawer request → typed reads show `AR-013` pending), `#/c2-console/SS-041` as holder (expiry → command input disabled, `Access expired. Request a new grant.`, exactly one expiry transcript line across unmount/remount).

**Browser gaps:** preview HTTP verification skipped per AGENTS.md § Windows Temporary Process Safety (preview check optional) — screen-level behavior is covered by the mounted-route tests above; live-browser click-through not performed.
