# 04: Wire planning and scoped AI conversations

**What to build:** An operator plans a real engagement through the new AI
workspace/copilot, reads the resulting documents and handoff readiness, and
returns to the same owned conversation after refresh.

**Blocked by:** 03 (real bootstrap and projects).
**Status:** in-progress (reopened by precommit verification, 2026-10-14)
**Requirements:** R04-R07, R09, R10; decision D6.
**Contract:** [execution.md](../execution.md).

## Acceptance

Follow-up: [regression fixes and live flow](../regression-fixes-and-live-flow.md)
records actual Soundwave planning, checkpoint question restore/resume, eight
validated generated documents and ready-only handoff. Selection/recovery and
parallel-answer regressions pass; the precommit failures below are historical.

The [precommit review](../verification-01-06.md) supersedes the completion
claim: selected conversation/recovery state is not durable, parallel questions
use the wrong resume request, and handoff is allowed while readiness is blocked.
A runtime-backed planning exchange has not been verified.

- [ ] Create/select/recover an owned planning thread with the trusted assistant
  and engagement context. Reuse the server's binding/request-ledger semantics;
  the browser cannot choose a workspace path or retarget an existing binding.
- [ ] Send planning messages and render actual streamed/checkpoint messages and
  pending questions. History and copilot reuse the same scoped conversation
  contracts; pin/search/context behavior follows the approved real feature scope.
- [ ] Project planning panels show actual documents, missing/invalid states,
  readiness and handoff confirmation. No demo approval state makes execution
  ready, and an OPPLAN document is not relabeled as business plan approval.
- [ ] Refresh restores the selected conversation/documents without dispatching
  another planning run. Scope changes discard old reads/stream updates.
- [x] Existing planning flow has a verified new-UI placement before its old
  frontend consumer is retired.

## Implementation notes

- **AI workspace** (D6): `src/real/screens/workspace.tsx` mounted at
  `ai-operator` (route id → engagement, else active project, else an explicit
  selection prompt). Planning threads are created with
  `POST /threads {requestId, kind:'planning'}` (browser generates only the
  request id; the server owns binding, assistant and workspace path), listed
  from the owner-scoped ledger, and restored from the thread snapshot on
  refresh — no dispatch happens on mount.
- **Request ledger** (`src/real/request-ledger.ts`): every send/resume follows
  its durable `RequestRecoveryView` to accepted/rejected/unconfirmed by polling
  the SAME stable requestId and reconciling uncertainty through
  `POST /requests/:id/reconcile` — the browser never re-dispatches a duplicate
  run. `unconfirmed` surfaces a "still tracked, use Reconcile" message.
- **Streaming** (`src/real/stream.ts`): `useRunStream` subscribes to the
  scoped SSE endpoint with EventSource (native reconnection + `Last-Event-ID`
  replay), validates every `run-event` payload with `isPublicStreamEvent`,
  counts malformed frames (never rendered) and forwards `control`
  (`stream_closed`/`stream_error`) frames as explicit recovery banners. The
  server keeps executing the run — disconnects end only the subscription.
- **Conversation surface**: snapshot messages + live delta/snapshot message
  merging deduped by messageId, reasoning traces rendered, tool/subagent
  events as an activity trace, run status polled from `GET runs/:run`
  (terminal → finalize + invalidate thread/planning queries), cancel-run
  exposed as cancellation of the runtime run (distinct from any approval).
  Pending interrupts render as answer cards (multiSelect/allowOther honored)
  and resume with `{requestId, value, questionId}` — an interrupt is not an
  invented pause/resume lifecycle.
- **Planning panel** (`src/real/screens/planning-panel.tsx` in the detail
  Planning tab): actual `PlanningView` — readiness banner with server reasons
  ("readiness is a runtime signal, not permission"), four document cards
  (ready/missing/invalid/unavailable states rendered honestly), the 9-document
  bundle chips, and the one-way handoff confirmation via
  `PATCH /engagements/:id {handoffConfirmed:true}` (never unset by the UI;
  OPPLAN labelled as the operational plan, not business plan approval).
- Scope hygiene: pin/search/copilot-context surfaces stay out of the real
  workspace per D4; the demo AI surfaces remain mock-only.

## Verification (2026-10-14)

- New suites: `src/real/planning-api.test.ts` (6), `request-ledger.test.ts`
  (5: stable-id poll/reconcile, no re-dispatch, rejected/unconfirmed), 
  `stream.test.tsx` (4: scoped URL, validated delivery, malformed-frame
  counting, control frames, cleanup, no-subscribe-without-run),
  `screens/workspace.test.tsx` (5: prompt, snapshot + pending question,
  ledger-bound create, send + live deltas + resume, empty state),
  `screens/planning-panel.test.tsx` (4: blocked readiness, one-way PATCH,
  confirmed state, load failure with retry).
- Combined affected regression: 20 files / **134 tests pass** (src/real 62,
  router/shell/state 72). One flaky parallel failure of the heavy component
  suites did not reproduce in isolated or combined re-runs.
- Typecheck, lint, production build clean.
- Live smoke (server + Vite dev proxy, Docker/Postgres running): `GET
  /api/agents` → 404 (runtime absent — honest unavailable), `GET
  /api/engagements/:id/plan-docs` → readiness blocked with the server's
  per-document reasons and truthful bundle states; wrong thread scope → 404;
  `PATCH /engagements/:id {handoffConfirmed:true}` → handoffConfirmedAt
  stamped and persisted on read-back; `POST /threads` without a runtime → 404
  (no mock fallback). Processes stopped by PID.
- Named gap: a live planning exchange (streamed tokens/interrupts against a
  real assistant) requires the Python runtime, which is not part of this
  environment; the wire behavior is covered by the captured-fixture contract
  tests (`tests/fixtures/w00`) and the stream/ledger suites above.

## Scope boundary

Independent business plan revision/review/deadline behavior is owned by 09.
Shared transport should grow only for the flow delivered here.
