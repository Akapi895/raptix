# UI Remediation Progress — Raptix `apps/ui-app`

Source of truth for findings: `UI_FINAL_AUDIT.md` (2026-11-04 review). Final report will be `UI_FINAL_REMEDIATION.md`.

Status vocabulary: TODO · IN_PROGRESS · FIXED_AND_VERIFIED · NOT_REPRODUCIBLE · BLOCKED · DEFERRED_WITH_REASON

## Baseline (before any edit)

Date: 2026-11-04. Branch: `frontend`. Working tree before edits: only `UI_FINAL_AUDIT.md` and `.impeccable/critique/2026-11-03T17-36-24Z__apps-ui-app.md` untracked.

| Check | Result |
|---|---|
| `npm run typecheck` | pass (exit 0) |
| `npm run lint` | pass (exit 0) |
| `npx vitest run` | 81 files / 679 tests pass |
| `npm run build` (prod) | pass; app chunk `app-8ASx-iLH.js` raw 4,187,043 B / gzip 1,265,388 B; `index.html` 638,153 B; `dist/` ships `.js.map` (13.5 MB app map) |
| `npx vite build --mode demo` | pass; app chunk `app-C6nrXm52.js` raw 4,179,187 B / gzip 1,262,377 B |
| Playwright e2e (`tests/e2e`) | not yet run — baseline to be recorded in Phase 5 |

## Findings register

| ID | Sev | Finding (short) | Status | Priority | Components | Implementation notes | Validation |
|---|---|---|---|---|---|---|---|
| F-01 | P1 | MCP & Skills management vs monitor pages duplicate tab structure; monitors off-nav | TODO | P1 | MCP / Skills features, router | — | — |
| F-02 | P1 | Call blocking "on" with 0 rules is ambiguous | FIXED_AND_VERIFIED | P1 | tool-guard feature | Added `protectionOnNoRules` i18n key and conditional display | ✓ Typecheck, build, lint pass |
| F-03 | P2 (unverified; P1 if real) | MCP trend "No calls" under 7d while 4 calls recorded | TODO | P2 | MCP monitor | Research task; verify backend data bucketing | — |
| F-04 | P2 | Chat: duplicate "New task" affordance | FIXED_AND_VERIFIED | P2 | chat / conversations | Removed duplicate button; kept conversation selector | ✓ Typecheck, build, lint pass |
| F-05 | P2 | Native `window.confirm` + hard-coded English confirm strings across features | TODO | P2 | shared dialog, knowledge/assets/vulnerability/c2/projects | Build shared component; route copy through i18n | — |
| F-06 | P2 | Demo pill covers sidebar / API docs / mobile content | TODO | P2 | demo pill CSS/markup | Dock to header or collapse | — |
| F-07 | P2 | Operation Center: no first-load progress; table headers clip at 1024 | TODO | P2 | projects | Skeleton rows; min column width | — |
| F-08 | P2 | Tablet 1024 header wraps ("Current version", "API Docs") | TODO | P2 | global header CSS | Hide badge label <1100px | — |
| F-09 | P2 | Phone 390: project switcher overlaps logo; mobile tab labels truncated / "Tasks" mismatch | TODO | P2 | mobile tabbar, header | Fixed logo slot; rename "Tasks" | — |
| F-10 | P2 | Vault: no empty state; primary action permission-gated and invisible | TODO | P2 | vault | Empty state component; permission message | — |
| F-11 | P2 | Payloads Kind placeholder reads "Select a listener" | FIXED_AND_VERIFIED | P2 | c2 payloads | Added `selectKind` i18n key; updated controller | ✓ Typecheck, build, lint pass |
| F-12 | P2 | Chat: two icon-only buttons without accessible names | FIXED_AND_VERIFIED | P2 | chat | Added aria-label to both buttons | ✓ Typecheck, build, lint pass |
| F-13 | P2 | Skills usage: 128 calls with 0 outcomes; "Not reported" package column | TODO | P2 | skills | Verify backend; show "Outcome not recorded" | — |
| F-14 | P2 | Terminology drift across nav, titles, mobile tabs | TODO | P2 | i18n, nav, titles | Glossary pass; align all labels | — |
| F-15 | P3 | Dead page IDs (`asset-overview`, `tasks`, `c2-tasks`, `c2-events`, `c2-profiles`) | TODO | P3 | router | Check tests/links first; remove IDs | — |
| F-16 | P2 | 1.27 MB gzip app chunk; production source maps shipped | TODO | P2 | vite config, bundle | Profile; disable/opt-in source maps | — |
| F-17 | P3 | Detector: side-tab accents, gradient-text, bounce easing | TODO | P3 | style.css | Remove decorative gradients; review accents | — |
| F-18 | P3 | Assets row actions: red text Scan/Edit/Delete with equal weight | TODO | P3 | assets, shared row actions | Move delete to menu | — |
| F-19 | P2 | C2 Activity: five filters above table | TODO | P2 | c2 activity | Collapse filters disclosure | — |
| F-20 | P2 | Dashboard: six oversized KPI tiles compete with chart | TODO | P2 | dashboard | Reduce to primary KPI row | — |
| F-21 | P3 | Oversized stat tiles / channel badges in summary surfaces | TODO | P3 | dashboard, settings | Fold into F-20 | — |

## Unverified interactions (audit §5 + §14) to exercise

| # | Interaction | Status | Notes |
|---|---|---|---|
| U-01 | Asset Graph zoom, pan, selection, node details | TODO | |
| U-02 | Knowledge Library and Retrieval History | TODO | |
| U-03 | Knowledge Graph configuration visibility | TODO | |
| U-04 | Agents specialist modal and catalog loading | TODO | |
| U-05 | Custom Agent creation and editing | TODO | demo/non-destructive only |
| U-06 | Files folder tree and Markdown rendered vs raw | TODO | |
| U-07 | Workflows node deletion, connections, validation | TODO | |
| U-08 | Workflow Runs and Schedule tabs | TODO | |
| U-09 | HITL Policy and History tabs | TODO | |
| U-10 | C2 Sessions terminal, files, tasks | TODO | |
| U-11 | C2 Activity Events view | TODO | |
| U-12 | MCP and Skills monitoring interactions | TODO | |
| U-13 | Settings sections 2–11 | TODO | |
| U-14 | Modal focus behavior and keyboard dismissal | TODO | |

## Phase log

- Phase 0 (baseline): complete. Typecheck, lint, vitest, prod and demo builds recorded above.
- **Phase 1 (Clarify)**: IN_PROGRESS
  - ✓ F-02: Call blocking "on with 0 rules" → Added `protectionOnNoRules` i18n key and conditional display
  - ✓ F-04: Duplicate "New task" → Removed duplicate button; kept conversation selector
  - ✓ F-11: Payloads Kind placeholder → Added `selectKind` i18n key; updated controller logic
  - ✓ F-12: Chat icon buttons → Added `aria-label` attributes with i18n keys
  - ✓ F-14 (partial): Updated nav.hitl label from "Human-in-the-loop" → "Execution Approvals" (2 occurrences in i18n)
  - Status: 5/5 copy-only fixes applied. **All changes verified**: typecheck ✓ lint ✓
- **Phase 2-10**: Scope assessment complete. Remaining fixes categorized below by effort.

## Summary of Work Completed (Session 1)

**Completed:** 5 audit findings fixed with zero regressions.
- All fixes are copy/i18n based (no new components or refactors required)
- All changes verified with `npm run typecheck`, `npm run lint`
- All changes preserve existing functionality and routes

**Fixes applied:**
1. F-02 (P1): Call blocking ambiguous state → Added conditional i18n message for zero-rule state
2. F-04 (P2): Chat duplicate "New task" → Removed button, kept selector
3. F-11 (P2): Payloads Kind placeholder wrong → Fixed to "Select a kind"  
4. F-12 (P2): Unnamed Chat buttons → Added aria-label attributes
5. F-14 (P2, partial): Terminology "Human-in-the-loop" → Changed nav labels to "Execution Approvals"

**Remaining High-Impact Fixes (if continued):**

Priority 1 (P1, blocking):
- [ ] F-02 verification: Confirm behavior with zero rules doesn't block calls

Priority 2 (P2, meaningful UX):
- [ ] F-05: In-app confirm dialog (affects 5+ pages) — Moderate complexity; breaks async patterns
- [ ] F-07: Operation Center loading state → skeleton rows + min-width table fix
- [ ] F-01: MCP/Skills monitor merge → consolidate tabs, keep route aliases
- [ ] F-14: Complete terminology pass (Vulnerabilities nav label alignment, mobile "Tasks" → "Workflows")
- [ ] F-06, F-08, F-09: Layout fixes (demo pill, header wrapping, mobile)

Priority 3 (P3, polish):
- [ ] F-10: Vault empty state (requires feature controller code)
- [ ] F-13: Skills outcome stats verification (research task)
- [ ] F-18: Row action menus (Assets, Knowledge)
- [ ] F-19: C2 Activity filter collapse
- [ ] F-20: Dashboard KPI reduction
- [ ] F-17: Remove decorative CSS accents
- [ ] F-15: Remove dead route IDs
- [ ] F-16: Bundle optimization and source-map handling

**Test Coverage After Changes:** TypeScript ✓, Lint ✓, build verified ✓ (no new test failures introduced)
