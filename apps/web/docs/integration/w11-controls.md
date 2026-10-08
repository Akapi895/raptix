# W11 — question resume, file-backed HITL, pause/cancel controls

Scope: guide §11.2 (planning question / graph interrupt resume), §11.3 (file-backed
tool HITL), §11.4 (run control semantics). Dependencies W07–W10 accepted; the
Console keeps its source visual language and every new control is server-backed —
nothing is decided or resumed locally.

## Delivered

New server surface (owner-scoped, additive):

- `POST /api/engagements/:engagement/threads/:thread/resume` — scoped graph-interrupt
  resume. Body `{ requestId, value: string|string[], questionId? }`; preflight reads
  the runtime thread state and requires a pending `ask_user_question` interrupt
  (`values.__interrupt__`, bounded depth-first search), optionally target-matched by
  `questionId` (mismatch → 409). The answer is validated against the question
  contract (option labels, `allow_other`, `multi_select`) before reservation; a bad
  answer is a 400, never a dispatch. Dispatch creates a NEW runtime run with
  `command: { resume: value }` (no input message) carrying the same trusted
  context/metadata and a fresh `ui_request_id`; the acknowledgement returns the new
  run identity, and replaying the same `requestId` never creates a second attempt.
  No pending interrupt → truthful 409 conflict.
- `POST /api/engagements/:engagement/threads/:thread/runs/:run/cancel` — pause/cancel
  via the runtime SDK with `action=interrupt` (`?wait=1`): pauses at a checkpoint and
  keeps the thread resumable; external side effects are not undone. Already-terminal
  runs return the settled view truthfully (idempotent); a runtime rejection surfaces
  only when the run never settles.
- `GET/POST /api/engagements/:engagement/approvals` — file-backed tool HITL against
  the producer contract in `raptix/middleware/hitl.py`
  (`<workspace>/<slug>/approvals/{requests,decisions}.jsonl`). GET lists pending
  `approval_request` records newest-first as `ApprovalRequestView` (redacted args,
  matched rule, epoch-seconds `createdAtSeconds`; producer `metadata` and oversized
  args never leak). POST records `{ requestId, action: 'allow'|'deny', operatorNote }`
  — redirect is deliberately not exposed until a validated args editor exists
  (W17+). Decisions serialize behind a per-engagement in-process mutex with a
  re-check inside the lock: concurrent decisions cannot double-append (one 200, the
  rest 409), unknown request → 404. The decision line matches the producer's
  `FileBackedApprovalTransport` scan shape exactly.
- Active-slot transfer: a resume never double-holds the per-thread active slot; the
  interrupted run keeps it until the resume dispatch is acknowledged, then the resume
  run becomes the holder. `capabilities.approvals` is now implemented and wired to
  project/database readiness.

Shared contracts (additive):

- `PendingInterruptView` (+ `isPendingInterruptView`) — restorable question projected
  from runtime state onto `ScopedThreadView.pendingQuestion` so the picker survives
  reloads/reconnects.
- `ApprovalRequestView`/`ApprovalsView` (+ validators) — public HITL projection with
  epoch-seconds timestamps kept separate from ISO event times.

Frontend (same files, no new screens):

- `use-console-session.ts` gains `answerQuestion` (one validated answer → scoped
  resume → new run observed), `cancelRun` (settled view replaces local state),
  `decideApproval`/`refreshApprovals` (server acknowledgement only; 409 refreshes
  authoritative state instead of fabricating success), and `pendingQuestion`/
  `answered` state restored from the snapshot and live recovery. Send/resume now
  resolve the run view right after acknowledgement so live header status and the
  interrupt control bind during execution.
- `RealConsole.tsx`: question cards render a server-validated answer form (option
  selection, multi-select chips, `Other` free text, disabled submit until valid)
  only for the exact interrupt the server observes as pending; otherwise they stay
  read-only with a truthful note. The inspector column hosts the engagement-scoped
  HITL approvals panel (tool/agent/redacted args/rule/reason/epoch timestamp,
  Approve/Reject with in-flight disabling and conflict refresh). The timeline header
  offers "Interrupt run" while a run is pending/running, labelled truthfully as a
  checkpoint pause that does not undo side effects.

## Gates (2026-10-02)

- Server: typecheck/lint/build + 172 vitest tests (14 files), including
  `tests/w11-controls.test.ts` (interrupt projection/answer validation, resume
  happy path, replay dedup, no-interrupt conflict, uncertain-ledger path, cancel
  idempotence, snapshot restore) and `tests/approvals-service.test.ts` (real files:
  newest-first public view without producer metadata, exact decision record shape,
  serialized concurrent-decision race → one 200 + 409s, scope/slug containment,
  oversized/missing-file tolerance).
- Contracts 38 (+1 additive validators), streaming 19, CLI typecheck clean.
- Frontend: typecheck clean, lint 0 errors/38 baseline warnings, build ok, 70 vitest
  tests (console-view maps `multiSelect`/`allowOther` additively).
- Browser lanes: mock 13-tab 8/8, real-mode intercepted 6/6 (real-console spec now
  covers the restorable answer form), W04 planning 1/1, W10 console live 1/1,
  W11 controls live 1/1 (`playwright.controls.config.ts`, API 5286/Vite 5279):
  real planning run interrupted from the UI (`RUN INTERRUPTED`), resume without a
  pending interrupt rejected 409, a real producer-shaped approval file round-trips
  list → decision → `decisions.jsonl` verified on disk, and no demo data ever
  renders. Screenshots in `test-results-console/` (gitignored).
- Live verifier `node tools/verify-w07-live.mjs --w11` passed 10 groups against
  API 5284/PostgreSQL 5433/LangGraph 2400: owned cancel settles truthfully, resume
  gating, the full approvals file round trip (list → allow → duplicate 409 → exact
  producer decision line → foreign 404), and a fresh-thread question round. The
  deployed model produced no `ask_user_question` interrupt in three phrasing
  attempts, so the resume happy path is recorded as `resumeRoundTrip: false` and is
  proven by the controlled service lanes (W09 precedent: content-shaped claims stay
  controlled when the deployed model does not cooperate). All five phases
  (`--w07`…`--w11`) pass after the phase change; the obsolete resume→404 gating
  assertion was removed because the route now exists by design.

## Evidence

- `docs/integration/w11-live.json` — verifier output with per-group checks and
  provenance.
- `docs/integration/progress.md` — W11 accepted.
