# 19: Wizard team, review and submission

**What to build:** Complete the five-step wizard with team assignment, review and typed create/save-draft/submit handlers.
**Blocked by:** 18.
**Status:** resolved
**Owner:** Wizard completion and project-create transaction.
**Contract:** [execution.md](../execution.md).

- [x] All five steps plus review run on one schema/draft with validation, dirty guard and submit/error state.
- [x] Creation transaction publishes project/assets/members/approval/notices together; the portfolio and legacy inbox observe it.
- [x] Unauthorized creation or invalid submission is rejected by real handlers as well as UI gating.
- [x] Create → portfolio → detail works; failed submission keeps the draft and permits retry without duplicate entities.

## Evidence

Implementation (all in `apps/web-improve`, after `git merge --no-edit web-improve-refactor` at 4f00b2d; 6 files, ~+100 runtime lines non-test):

- `src/features/wizard/service.ts` (new) — `createProjectTransaction(authority, clock, ctx, dr, submit)`, the one real creation handler. Refusal order: role gate (admin/manager only → `forbidden`, "Only a Red Team Manager or Organization Admin can create projects.") → required name/client → code format (`RT-2026-016` shape) → duplicate code (`conflict`, with the schema's suggested-next-code message). On success it commits ONCE through the shared authority: project (with embedded members), assets (in-scope → `pending` until approval), the `Project creation` approval, the reviewer notice and the audit row — one ChangeSet publication. The submission essentials (in-scope asset, emergency contact, window) keep the baseline parity rule: a submit without them lands as `draft`, never as a pending project awaiting an impossible approval; the wizard's review fail rows remain the UI gate with reasons.
- `src/store.tsx` (append-style delegation, per the execution contract "a legacy action delegates to the new handler once that handler owns its behavior") — `A.createProject` now builds the request context from the current persona and delegates to the handler, then performs only the pid switch. A refusal returns `''` with every entity unchanged. The wizard's single `A.createProject` delegation from ticket 17 is preserved — no second creation path; audit/notice `at` stamps move to the factory clock (`formatDemoInstant`), same display format.
- `src/features/wizard/use-project-wizard.ts` — the typed submit error state: a handler refusal (`''`) resets `saving`, surfaces "The submission was rejected. Your draft is kept in the form — check the validation panel, then try again." and stays on the wizard, so the draft survives and can be fixed and retried. Everything else (one RHF instance, Zod step gates, dirty guard, toast + redirect contract) inherited unchanged.
- `src/features/wizard/draft.ts`, `src/screens/b-wizard.tsx` — doc comments flipped from "compat until 19" to the migrated state; step 5 renders identically (composed draft review cards, pass/review/fail rows with `Resolve` jumps, Create Draft always allowed, Submit gated by blocking rows + confirmation).

Checks (all in `apps/web-improve`):

- `npm run typecheck` — clean, 0 new diagnostics.
- `npm run lint` — 218 warnings, 0 errors (at the 218 baseline; wizard files and the new service contribute 0).
- `npm test -- --run` — 32 files / **420 passed** (417 baseline + 3 new in `src/features/wizard/wizard.test.tsx`; all 15 prior wizard tests, including the five-step compat flow landing identical state, stay green).
- `npm run build` — success (pre-existing chunk-size advisory only).

New tests (`src/features/wizard/wizard.test.tsx`, rendered against the real store/services unless noted):

- Review fail rows block submission with reasons (`Submit is blocked by:` listing `At least one in-scope asset` and `Emergency contact provided`), nothing is committed on the failed attempt, and resolving the rows on the same draft retries into exactly one entity set: one project `pending`/ROE `pending` with owner + reviewer members, one asset, one pending `Project creation` approval, the reviewer notice (`RT-2026-021 is waiting for your ROE approval`) and the audit row — plus the single-ChangeSet proof (exactly one commit, corr `legacy`, entities contain project/asset/approval/notice/audit), the pid switch to the new project and the legacy toast.
- Handler-level refusals commit nothing (JSON snapshot identical): analyst and viewer → `forbidden`; duplicate code `RT-2026-014` → `conflict` with the suggested alternative; malformed code → `validation` "Code must look like RT-2026-016."; blank name/client → the schema-verbatim messages.
- An unauthorized persona (viewer) is gated in the UI ("You do not have permission to create projects") and the handler-backed `A.createProject` refuses with `''`, leaving the dataset and the mounted wizard unchanged — real-handler enforcement and UI gating proven at the same surface.

Create → portfolio → detail wiring: the wizard lands on `#/project` with the new pid (covered above and by the kept dirty-guard/compat tests); the portfolio observing a legacy-created project is pinned by the existing bridge tests (`b-portfolio.test.tsx` "a legacy-created project appears in the new portfolio", `dashboard.test.tsx` bridge-refresh), which run against the same delegated action and stay green.

Gaps:

- Browser/preview verification of the live `#/project-new` route was skipped per AGENTS.md — Windows Temporary Process Safety (preview HTTP check optional; no server spawned). Success/refusal wiring is covered by rendered tests against the real store providers; recorded as a gap per execution.md.
- `A.createProject` refusals return `''` (the action's string contract) rather than a typed result; the wizard surfaces a generic kept-draft message for this defense-in-depth path — the specific refusal reasons are proven at the handler level, and the UI's own gates explain every reachable refusal before the call.
