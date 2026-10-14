# 38: AI chat and plan proposals

**What to build:** Migrate conversations, mode selection and simulated proposal generation to real shared services, preserving cancellation and project binding.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Conversation/chat and draft-plan creation handlers.
**Contract:** [execution.md](../execution.md).

- [x] Observe/Propose/Execution modes change assistance behavior but never grant permission or initiate tool/operation execution.
- [x] Generated plans remain draft/proposed; out-of-scope requests produce blocked proposals without data leakage.
- [x] Send/cancel/reset and late responses respect the captured actor/project and dispose timers.
- [x] Chat cards and plan detail links work with legacy review until 39; new proposals update canonical history/notices.

## Evidence

**Migration (ADR-0067 feature-local service):** `src/features/aichat/` —
`service.ts` (typed `ChatService`: scoped `list`/`get` reads through the
factory's superseded-scope guard; synchronous atomic `create`/`setMode`/
`setPinned`/`send`/`respond`/`stop` commits through the one database
authority; `buildPlanProposal` + `respondToChat` own the simulated proposal
generator moved out of the legacy store), `handlers.ts` (call-time request
contexts), `query.ts` (`chatKeys` over `conversation` entity keys + `useConversationList`).
`src/domain/service-factory.ts` wires `chat(actor, projectId)` (append-style);
`src/store.tsx` legacy actions `createConversation`/`setConversationMode`/
`togglePinConv`/`sendChat`/`stopChat` now delegate to the handlers and keep
only the demo's response orchestration (busy flag + 900 ms timer, disposed on
stop and demo reset); `src/screens/g-chat.tsx` reads conversations through
Query and creates/sets mode through the typed handlers.

**Proposal-invariant enforcement site:** `src/features/aichat/service.ts` —
`respondToChat` only ever writes conversation messages, `proposed`/`draft`
plans and *denied* tool events (+ audit rows); the `ChatService` surface has
no operation-start/approval/tool-allow capability (asserted by key set in
`query.test.tsx`), and an execution request — even in Approved Execution
mode — commits nothing execution-shaped. Modes are display intent:
`setMode` commits a preference and nothing else (execution-shape snapshot
assertion); a non-member cannot address the conversation at all.

**Checks (all green):**

- `npm run typecheck` — 0 errors.
- `npm run lint` — 219 warnings / 0 errors (baseline preserved).
- `npm test -- --run` — 24 files, 283 passed = 268 baseline (incl. the
  `src/safety/ai-proposals.test.tsx` invariant suite, kept green through the
  delegated actions) + 15 new in `src/features/aichat/query.test.tsx`:
  bridge proof (service send → legacy conversation consumer), draft/proposed
  only, no-execution-path (surface + behavior), mode-cannot-grant,
  stop/cancel, late-response project binding, reset disposal, out-of-scope
  blocked without cross-project leakage, observe read-only, proposal →
  legacy plan review lifecycle with canonical history/notices, read scope
  (not-found/forbidden/aggregate), Observe/Propose/Execution display-only
  rendering.
- `npm run build` — success.

**Gaps:** browser/preview walkthrough of `#/ai-operator` not performed —
preview HTTP check skipped per AGENTS.md § Windows Temporary Process Safety
(optional verification); behavior is covered by the mounted-screen test for
the workspace route.
