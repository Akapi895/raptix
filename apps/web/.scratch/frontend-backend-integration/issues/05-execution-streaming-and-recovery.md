# 05: Execute real runs with streaming and recovery

**What to build:** An operator executes a ready engagement, watches actual run
events/tool trace, answers pending questions/HITL and recovers safely from a
disconnect or uncertain command response.

**Blocked by:** 04 (planning and AI conversations).
**Status:** in-progress (reopened by precommit verification, 2026-10-14)
**Requirements:** R03-R07, R08, R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

Follow-up: [regression fixes and live flow](../regression-fixes-and-live-flow.md)
fixes the listed regression failures and verifies actual execution success,
browser refresh without duplicate dispatch and native SSE late replay. Live
tool-HITL and cancellation acceptance remain unexecuted, so closure stays open.

The [precommit review](../verification-01-06.md) supersedes the completion
claim. Reproduced failures include lost POST acknowledgement recovery, missing
run restore, wrong terminal statuses, missing thread verification, duplicate
and foreign SSE delivery, stale callbacks, and incorrect parallel resume.
Live runtime run/interrupt/cancel/reconnect acceptance remains unexecuted.

- [ ] Create/recover an owned execution thread and submit a run only with verified
  planning/runtime context. The operation/console view follows the mapping in 01
  and retains engagement/thread/run/request identities and truthful status.
- [ ] Consume scoped SSE with actual cursor/control-frame semantics, deduplicate
  replay, and distinguish current-run events from unattributed thread history.
  Tool trace retains independent policy/approval/execution facets and lineage.
- [ ] Restore and answer every pending parallel graph question using interrupt
  identities; expose actual tool HITL decisions without conflating business
  approval. Execution modes or AI-generated proposals confer no permission.
- [ ] Cancellation acceptance is distinct from verified termination. Unsupported
  generic pause/schedule/global-stop controls stay unavailable until 09.
- [ ] Handle accepted/rejected/uncertain requests, stable-ID retry/reconcile,
  refresh and reconnect without duplicate run dispatch. Disconnect/unmount ends
  only the subscription, not the server-owned run.

## Implementation notes

- **Execution threads** (`src/real/screens/workspace.tsx`): the AI workspace now
  hosts planning AND execution conversations. Execution thread creation is
  gated on the one-way planning handoff (button disabled with an explanatory
  title until `handoffConfirmedAt` exists) — execution never bypasses it.
- **Verified runtime context** (R06): before any execution interaction the
  workspace loads `GET /runtime-context?kind=execution` and requires the
  server's own `executionReady` flag; the composer renders the server-verified
  context banner (assistant/workspace/planning state) and stays disabled with
  an explicit "Execution is blocked" reason otherwise.
- **Scoped streaming vs history**: current-run activity (SSE `run-event`
  frames) renders under "Current run activity"; unattributed checkpoint
  transcripts from the thread snapshot render separately as "Thread history
  (checkpoints)" and are never labelled as current-run work (R07). Cursor
  semantics stay with EventSource (`Last-Event-ID` replay); control frames
  surface an explicit recovery banner stating that the server keeps running
  the job; disconnects/unmounts end only the subscription.
- **Interrupts**: restored parallel `pendingQuestions` render per-question
  answer cards (multiSelect/allowOther honored) and resume via
  `POST /resume {requestId, value, questionId}` — runtime interrupts only,
  never a pause/resume or business-approval lifecycle.
- **Workspace HITL** (`ApprovalsCard`): file-backed tool approvals from
  `GET /approvals` (agent, tool, redacted args, reason, matched rule incl.
  timeout/default-on-timeout) with Allow/Deny through
  `POST /approvals {requestId, action, operatorNote}` — an operational tool
  decision, explicitly labelled as never business approval. Decision success
  invalidates approvals + thread state.
- **Request recovery**: an `unconfirmed` ledger outcome now offers a Reconcile
  action that follows the SAME stable requestId through
  `POST /requests/:id/reconcile` (accepted/rejected/uncertain handled; no
  duplicate dispatch).
- **Operations panel** (`src/real/screens/operations-panel.tsx`, detail
  Operations tab): engagement-scoped execution threads with their runtime runs
  (runId, requestId, truthful rawStatus, created/updated) and adaptive polling
  while runs are active; "Open AI workspace" for execution. Per D2 only
  engagement/thread/run/request identities are shown — no invented
  business-operation record.
- Capability gate: without the assistant runtime the workspace renders an
  honest "runtime is not available" panel driven by the capability document
  (`agents.supported/available`), never a mock conversation.

## Verification (2026-10-14)

- Suites: `workspace.test.tsx` grew to 8 tests (execution-thread handoff gate,
  server-context execution block, HITL allow decision + rule rendering, plus
  the ticket-04 coverage); new `operations-panel.test.tsx` (3: run table with
  request identities + raw status, honest empty state, workspace link);
  `stream.test.tsx` (4) and `request-ledger.test.ts` (5) unchanged.
- Combined affected regression: 21 files / **140 tests pass** (src/real 68,
  router/shell/state 72). Typecheck, lint, production build clean.
- Live smoke (server + Vite dev proxy): `GET /approvals` → 0 pending,
  source workspace (registered without the runtime — workspace-backed); 
  `GET /runtime-context?kind=execution` and `GET /threads` → 404 with the
  runtime unconfigured (routes intentionally unregistered — the UI renders the
  honest unavailable panel via `capabilities.agents=false/false`); both
  processes stopped by PID.
- Named gap: a live execution run with streamed events and a real HITL
  decision requires the Python runtime (`LANGGRAPH_API_URL`) which is not part
  of this environment; wire behavior is covered by the captured-fixture
  contract tests and the stream/ledger/workspace suites above.

## Scope boundary

Persisted business operations, scheduling and broader emergency stop are owned by
09. A runtime interrupt is not an invented pause/resume lifecycle.
