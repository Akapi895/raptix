# 60: Context-aware copilot drawer

**What to build:** Migrate the copilot drawer to shared UI context and typed assistance services, preserving proposal-only behavior.
**Blocked by:** 59.
**Status:** resolved
**Owner:** Copilot feature; header wiring sequenced after 59.
**Contract:** [execution.md](../execution.md).

- [x] Drawer opens from each feature with the active route/entity/project context and an accessible focus lifecycle.
- [x] Persona/project changes cancel stale assistance and refresh context without exposing old engagement content.
- [x] Suggested actions remain proposals and use permission-gated navigation; opening the drawer grants no execution authority.
- [x] Notifications/drawer exclusivity and reset behavior retain one UI state authority.

## Evidence

**Feature-local modules (branch `wi/60-copilot`):**

- `src/features/copilot/drawer.tsx` — the `CopilotDrawer` slot implementation (169 lines). Reads the conversation through the typed ChatService list via ticket 38's `useConversationList` Query binding (scope-keyed cache; the drawer fetches only while open via the new `enabled` option), so it renders only the active project's accessible conversations — an out-of-scope read renders the handler's `not-found` refusal (`data-testid="copilot-refusal"`), never content (the legacy drawer read `db.conversations` unscoped). Conversation auto-create goes through the typed `createChatHandlers` once the scoped read resolves (guarded, refusal toasted); sending stays on the bridged legacy action `A.sendChat`, which owns the demo's response orchestration (busy flag + 900 ms timer) and commits through the same handlers — identical to the migrated AI workspace (ticket 38). Visibility/context stay in the shared ticket-05 UI authority (`copilotOpen`/`copilotCtx`); project switch closes the drawer; the accessible focus lifecycle is preserved (dialog + focus trap + Escape + opener restore).
- `src/features/aichat/query.ts` (append, +8/−3) — `useConversationList` takes an optional `{ enabled }` so the drawer's closed state neither fetches nor keeps an active subscription; the ChangeSet bridge still marks the entry stale so opening refetches.
- `src/router/host.tsx` (append-style, +5/−3) — fills `ShellSlots.copilotDrawer` with the migrated drawer at the mount site (one import + one prop, mirroring ticket 59's `notifications` fill). `src/shell/*` internals untouched; the legacy `src/screens/ai-copilot.tsx` stays the slot default for direct `Shell` mounts, and the `askAi` trigger keeps its legacy default (it already derives the route context into `CopilotCtx`).

**Proposal invariant (requirement 5):** every drawer surface action is a chat message, a proposal request ("Propose Next Step" → confirm modal → chat proposal + "It stays a proposal until a reviewer approves it") or permission-gated navigation ("Create Draft Finding" → `go('finding-new')` behind `can('createFinding')`; "Open full workspace" → the AI workspace). The rendered surface is asserted free of any execution/approval control (`/execute|start|approve|allow/i` buttons absent), and the propose flow's only entity writes are a `proposed` plan with no operation bound to it — the chat service itself remains the proposal-shaped surface proven by ticket 38 (surface keys have no execution capability).

**Bridge proof (tests in `src/features/copilot/drawer.test.tsx`, 9 passing, rendered through the real route host so the slot composition is exercised):** a typed-service `chat.send` commit reaches the open drawer without a reload (ChangeSet → conversation-query invalidation → refetch); a quick prompt through the bridged action renders both the user message and the assistant turn the same way; the persona switch to a non-member re-scopes the read to a refusal with the previous engagement content gone; project switch closes the drawer.

**Tests (9):** slot composition + context chips; scoped read (only the current project's thread; seeded proposal card visible; no other project's content); non-member refusal without content leak; proposal-only surface (absence of execution/approval controls, confirm-modal copy, proposal toast, `proposed`-status plan with no operation, drawer shows the "nothing has run" reply); quick prompts (chip → user message → assistant reply); typed-service bridge; typed-handler auto-create for a project without a conversation; close on project switch; all-projects guard (NoProject, no composer).

**Verification:** `npm run typecheck` clean (0 new); `npm run lint` 217 warnings / 0 errors (baseline 217, none from touched files); `npm test -- --run` 555/555 across 41 files (546 baseline + 9 new); `npm run build` green.

**Gaps:** browser/preview walkthrough (drawer at 768–1440 widths, light/dark) not performed per AGENTS.md § Windows Temporary Process Safety — covered instead by the rendered jsdom cases through the real route host. Runtime budget: ~179 added runtime lines across 4 touched files (caps 400/10).
