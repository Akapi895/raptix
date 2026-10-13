# 17: Project wizard shell, information and objectives

**What to build:** Establish the wizard draft/form shell and migrate information/objective steps; retain the remaining steps through the shared draft adapter until their owners land.
**Blocked by:** 16.
**Status:** resolved
**Owner:** Wizard shell and draft schema.
**Contract:** [execution.md](../execution.md).

- [x] Information/objectives validate inline; invalid data cannot advance.
- [x] Back/forward retains the same draft and completion state across migrated and compatibility steps.
- [x] The existing end-to-end creation flow remains usable; no second project creation path/database is introduced.
- [x] Dirty/cancel behavior is wired and exercised; draft shapes are typed for later steps.

## Evidence

Implementation (all in `apps/web-improve`, after `git merge --no-edit web-improve-refactor` at da97219):

- `src/features/wizard/draft.ts` (new) — one typed `WizardDraft` (Zod `z.infer`) powering all five steps: the shared schema (info/objectives constraints real; scope/ROE/assets/team fields permissive compat until 18/19), cross-field refines (`when: () => true` so they stay independent of required-field checks, matching legacy per-field validators), the frozen-at-mount step map (`WIZARD_STEPS` — `fields` = migrated Zod steps, `validator` = compat legacy validators), draft defaults, `nextId`/`fmtDate`, `reviewIssues` (step-5 pass/review/fail rows + submit gate), and `toLegacyProjectDraft` — the one adapter into the legacy store action.
- `src/features/wizard/use-project-wizard.ts` (new) — the shell hook: one React Hook Form instance over the whole draft (`zodResolver(makeWizardSchema(ids))`, `mode: 'onTouched'`), so back/forward retains values and completion state across migrated and compat steps; step transitions gate on the step's validation; `formState.isDirty` drives the shared unsaved-changes guard via `useDirty(isDirty && !done, saveDraft)`; save-draft/create delegate to `A.createProject` (the single canonical creation path) with the legacy toast + redirect contract; `set`/`update` accessors keep the compat steps wired unchanged.
- `src/screens/b-wizard.tsx` (rewritten in place, +102/−186) — steps 1 (Basic Details) and 2 (Objectives, RHF `useFieldArray`) render registered RHF fields with inline errors; steps 3–5 keep their legacy bodies byte-for-byte where possible, reading the same draft through the hook. No manifest/route changes (`project-new` still resolves to this screen via `b.tsx`).

Checks (all in `apps/web-improve`):

- `npm run typecheck` — clean, 0 new diagnostics.
- `npm run lint` — 219 warnings, 0 errors (baseline 219; new files contribute 0).
- `npm test -- --run` — 24 files / **276 passed** (268 baseline + 8 new in `src/features/wizard/wizard.test.tsx`).
- `npm run build` — success (pre-existing chunk-size advisory only).

New tests (`src/features/wizard/wizard.test.tsx`, rendered against the real store):

- Wizard shell renders five steps with stepper state: `aria-current='step'`, unvisited steps disabled, visited steps enabled/navigable via the stepper.
- Step 1 blocks an invalid advance with inline errors (missing name/client, malformed code, duplicate `RT-2026-014` with the suggested-next-code message); only valid data advances.
- Step 2 validates the main objective and requires at least one specific objective (array-level refine); the incomplete-objective warn renders without blocking, matching legacy semantics.
- Back/forward retains the same draft (goal, objective, scope text) and completion state across migrated and compat steps.
- Dirty guard: a dirty draft flips the `Draft: not saved` badge, registers `store.dirty`, and any in-app `go()` opens the unsaved-changes guard (`store.unsaved` with `save`/`next`) while the wizard stays mounted; discard leaves without creating; the guard's Save-Draft callback creates the draft through the legacy action and lands on `#/project` with the new project selected.
- Compat creation flow: the full five-step walk reaches review, `Submit for Approval` is disabled with the blocking reasons listed (no in-scope asset, no emergency contact), nothing is created on refusal, and Create Draft commits through the single legacy path (`status/roeStatus: draft`, `Oct 20, 2026` date adapter, composed `desc`, objectives flowed, pid switch, legacy toast).
- Save Draft on an invalid step 1 refuses with the warning toast, surfaces inline errors and stays on the wizard.

Gaps:

- Browser/preview verification of the live `#/project-new` route was skipped per AGENTS.md — Windows Temporary Process Safety (preview HTTP check optional; no server spawned). Success/refusal wiring is covered by rendered tests against the real store providers; recorded as a gap per execution.md.
- Step-level error display for migrated steps validates on blur (`onTouched`) in addition to on advance — slightly earlier than the legacy show-on-advance gate, matching standard RHF form behavior; the stepper badge still keys on attempted steps.
