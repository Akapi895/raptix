# 18: Wizard scope/ROE and assets

**What to build:** Migrate wizard scope/ROE and initial asset-entry steps onto the shared validated draft.
**Blocked by:** 17.
**Status:** resolved
**Owner:** Wizard scope/asset inputs.
**Contract:** [execution.md](../execution.md).

- [x] Window/contact/scope fields show validation; invalid essentials block progression/submission appropriately.
- [x] Asset additions/removals and in/out proposals survive step navigation and remain pending until approval.
- [x] Selected project/persona context cannot silently retarget the draft.
- [x] Compatibility team/review steps still submit a coherent project through the canonical bridge.

## Evidence

Implementation (all in `apps/web-improve`, after `git merge --no-edit web-improve-refactor` at b2a3f3e; 4 files, ~+160/−70 runtime):

- `src/features/wizard/draft.ts` — the legacy `scopeIssues`/`roeIssues` validators are gone; their constraints moved verbatim into the shared Zod schema: `scopeDesc`/`window` required field defs (`scopeFields`), the approver's relational rules (required, ≠ owner, on the member list) as `superRefine` issues on `makeWizardSchema` alongside date order/objective presence/duplicate code. `emergency`, `roeFile` and in-scope-asset presence stay deliberately schema-permissive — they gate submission through the review panel's fail rows (`reviewIssues`), never draft creation or step progression, matching today. `WIZARD_STEPS` steps 3 (`SCOPE_FIELDS`) and 4 (`ROE_FIELDS`) flipped from `validator` to `fields`; the `validator` option and its `next()`/`validateWizardStep` branches are retired (step 5 is presentation-only until 19). Step-5 review rows and the submit gate now read schema-derived live errors — same rows, same messages, same blocking levels.
- `src/features/wizard/use-project-wizard.ts` — dropped the retired `def.validator` gate branch; steps 3–4 now gate through the same async RHF `trigger` as steps 1–2. Nothing else changed: dirty tracking, unsaved-changes guard, frozen ids/defaults/schema at mount and the single `A.createProject` creation path are inherited, not duplicated.
- `src/screens/b-wizard.tsx` — steps 3–4 inline errors now render from `formState.errors` (RHF + Zod) like steps 1–2; the ROE banner stays on the attempted-gated live check so table edits (removing the reviewer) re-reveal it without a new blur/trigger. Asset add/remove, Check Scope preview, ROE doc, member/reviewer bodies unchanged.

Checks (all in `apps/web-improve`):

- `npm run typecheck` — clean, 0 new diagnostics.
- `npm run lint` — 218 warnings, 0 errors (at/below the 219 baseline; wizard files contribute 0).
- `npm test -- --run` — 28 files / **354 passed** (347 baseline + 7 new in `src/features/wizard/wizard.test.tsx`).
- `npm run build` — success (pre-existing chunk-size advisory only).

New tests (`src/features/wizard/wizard.test.tsx`, rendered against the real store unless noted):

- Pure schema check: `validateWizardStep` enforces the legacy scope/ROE messages verbatim (scope/window required; approver required, ≠ owner, on the member list; default Pat Kim valid).
- Step 3 blocks an invalid advance with inline errors (`Describe the testing scope.`, then window cleared → `Enter the permitted testing days and hours.`), stays on the step, creates nothing; asset entry validates (empty name/ident refused, duplicate identifier refused, added asset renders).
- Step 4 approver cross-field rules block progression (approver = owner → banner + no advance; fixed reviewer → review reached).
- Shared-schema cross-field date-order rule still gates the flow (end < start blocks on step 1).
- Asset additions/exclusions and ROE entries survive back/forward navigation (in/out lists, window, emergency contact all retained across step 3 ↔ 4) with the dirty guard armed (`Draft: not saved`, `store.dirty`).
- Persona switch mid-flow (`setMe('Jordan Lee')`) cannot retarget the frozen draft (scope text, name, code RT-2026-077 and owner unchanged).
- Submit path: with scope essentials (scope, window, in-scope asset, emergency) the review gate enables, `Submit for Approval` creates the project `pending`/ROE `pending` with the in-scope asset landing as `pending` scope; after `A.decideApproval(approved)` the project flips to `approved` and the asset to `in` — proposals remain pending until approval.
- Compat five-step flow (ticket 17 test, updated navigation pacing only): still blocks an invalid submit (no in-scope asset, no emergency contact), still creates the draft with identical state (`draft`/`draft`, `Oct 20, 2026`, composed desc, objectives flowed, pid switch, legacy toast) through the single legacy bridge.

Gaps:

- Browser/preview verification of the live `#/project-new` route was skipped per AGENTS.md — Windows Temporary Process Safety (preview HTTP check optional; no server spawned). Success/refusal wiring is covered by rendered tests against the real store providers; recorded as a gap per execution.md.
- Steps 3–4 gates are now asynchronous (RHF `trigger`) like steps 1–2; the legacy test's back-to-back Next clicks are replaced by awaited transitions (noted inline). Rapid double-clicking now advances one step instead of two — the same race steps 1–2 have had since ticket 17.
- The scope-check preview (`Check Scope`) remains an informational banner, not validation, as today; the in/out conflict it warns about is prevented at entry by the duplicate-identifier check.
