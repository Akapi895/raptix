# W10 — source Operator Console real binding

Scope: guide §11.1 (real-data components), §12.3 (Console reads/mutations), WP W10
gate "native planning/root UX within same page". Dependencies W07–W09 were already
accepted; question resume/file HITL and pause/cancel controls stay W11 and are never
faked here.

## Delivered

New server surface (owner-scoped, additive):

- `GET /api/engagements/:engagement/threads` — bound-thread selector feed for the
  Console: `ScopedThreadListView { engagementId, threads, source:'runtime' }`,
  newest activity first, bounded 1–100 rows, filtered to bindings whose immutable
  context hash still matches the project (stale-context bindings are never shown).
  Foreign engagement → 404 like every other scoped read.
- `RunService.listThreads` + `RuntimeOwnershipService.listBindings` reuse the same
  transaction/ownership path as run APIs; no new table, no migration.

Shared contracts (additive):

- `ScopedThreadListView` + `isScopedThreadListView` (validates each binding via the
  existing `isThreadBindingView`; rejects fixture provenance).

Frontend real Console (new files, no legacy/mock imports):

- `features/agent-runs/use-console-session.ts` — one canonical per-thread store:
  loads the selector feed, creates planning/execution threads through the W07
  reservation-ack endpoints (`requestId` dedup, poll-to-acceptance), hydrates the
  W09 checkpoint snapshot + transcript merge on select, resolves the latest
  non-terminal run from the owned run page, and observes it through the W08
  GET-only SSE stream with reconnect/recovery. Submits root messages with the same
  ACK-recovery contract; no run is dispatched without a server acknowledgement.
- `features/agent-runs/console-view.ts` — pure mapping (unit-tested, no React/fetch)
  from the stream state to ordered timeline items (operator/agent/tool/invocation/
  question/interrupt/handoff) and the inspector summary. Checkpoint history is
  appended only for entries the live set does not already contain, keyed by
  provenance identity, so reconnects never duplicate cards. Every item keeps
  `runId`/`source` provenance.
- `features/agent-runs/RealConsole.tsx` — source visual language (timeline with
  connector dots, inspector column, mono command bar) bound to real data only.
  Thread selector + New planning/execution chat in the timeline header; transport
  chip reflects server truth (`LIVE`/`RECONNECTING`/`RECOVERY REQUIRED`/`NO ACTIVE
  RUN`); run status tag renders the raw runtime status. Questions render read-only
  with an explicit "resume arrives with W11" note; no approve/reject buttons, no
  OPSEC scores, no synthetic phases — the source demo timeline
  (`INITIAL_EVENTS`/`PHASE_GROUPS`) is not imported anywhere in real mode.
- `app/RealApp.tsx` mounts `RealConsole` for `operator-console`; the unavailable
  reason for that screen is removed (`real-capabilities.ts`), and the W03
  capabilities test now asserts Console is connected.

## Intentional limits (truthful states, not failures)

- Question answering, file-backed HITL, pause/cancel/resume controls: W11.
  The question card says so; approve/reject buttons do not exist in real mode.
- Subagent addressable messaging stays off (no runtime contract yet); selected-agent
  inspection shows observed runtime instances only.
- OPSEC scores / synthetic thought cards are source-demo only and never rendered
  from real data (private reasoning is not exposed by the public projection).

## Gates

- Frontend typecheck/lint/build: pass; lint 0 errors / 38 retained source warnings.
  Frontend vitest 70 pass (+3 console-view, +1 updated capabilities test).
- Server typecheck/lint/build: pass; 155 tests (+1 listThreads selector feed).
- Shared contracts 37 (+1 selector-list validation), streaming 19, CLI typecheck: pass.
- Mock production browser: 8/8 (13-tab baseline unchanged). Real-mode lane
  (`playwright.real.config.ts`, intercepted, no backend): 6/6 — the two new
  deterministic Console specs (`tests/e2e/real-console.spec.ts`) cover owned
  history/question rendering with provenance, read-only questions, auto-selection,
  composer gating and demo-data absence; route globs were fixed to match
  query-less URLs, which is why these specs had never passed before being wired
  into the lane.
- W04 real planning browser regression: 1/1 (no interference from the new lane).
- Live HTTP gate `node tools/verify-w07-live.mjs --w10` (API5284 + PostgreSQL5433 +
  LangGraph2400): 7 groups — see `w10-live.json`; includes the new selector-feed
  group (owner-scoped, newest-first, bounded, foreign engagement denied) on top of
  the W07/W08/W09 run/stream/history groups.
- Live browser gate `playwright.console.config.ts` (real Vite 5278 + compiled API
  5285 + fresh test DB + LangGraph2400), `tests/e2e/real-console-live.spec.ts`:
  capabilities runs available → console opens with no demo data → "New planning
  chat" binds a real native thread (selector value = threadId, `GET /threads`
  returns it with `source:'runtime'`) → root message submitted from the command bar
  → OPERATOR card with the submitted text, AGENT reply card, `RUN SUCCESS` tag, one
  owned successful run in the scoped run page → after `reload()` the timeline is
  recovered from checkpoint history with HISTORY provenance tags, the same
  user/assistant content, `NO ACTIVE RUN`, and still zero demo data
  (ReconBot-01/OPSEC/Approve). Screenshot: `w10-real-console-live.png` (test output).
  Runtime proof: thread `soundwave` run `success` with `ui_request_id: ui-…`
  (browser-generated) and human/AI messages on the deployed runtime; the owned
  runtime thread and workspace fixture were deleted after the gate.

## Commands

```bash
npm run test:e2e --workspace=@raptix/web-raptix                                  # mock 13-tab 8/8
npm run test:e2e --workspace=@raptix/web-raptix -- --config playwright.planning.config.ts
node tools/verify-w07-live.mjs --w10
$env:W10_TEST_WORKSPACE='D:\.VTNet\redteam\raptix\workspace'
$env:W10_TEST_DATABASE_URL='postgresql://w02_test_20261001:w02_local_test_only@127.0.0.1:5433/raptix_web_w02_fresh_20261001'
npm run test:e2e --workspace=@raptix/web-raptix -- --config playwright.console.config.ts
```

## Next dependency

W11 — question resume (`ask_user_question` scoped resume, duplicate-emission guard)
and file-backed tool HITL decisions, plus verified pause/cancel controls; the
Console already renders the question/interrupt surfaces read-only.
