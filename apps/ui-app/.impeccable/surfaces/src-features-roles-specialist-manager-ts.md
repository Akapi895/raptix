# Surface brief — Agents page (`/#agents`, features/roles)

## Scope and mode

One canonical management page (`#page-agents`, feature id `agents`) replacing the old
`#specialist-management` two-pane layout. Mode: **Operate**. Redesign that keeps the
app's established visual world (light theme, `--accent-color` red, system sans, 12px
modal radius); the old two-pane + stacked-table composition is evidence, not authority.

## Audience, job, constraints

- Pentest operators manage runtime specialists and custom agent personas between runs.
- Job: see at a glance which agents exist and which carry custom configuration; open
  one and adjust its skills/tools/MCP additions for global or project scope.
- Constraints: additive-only configuration, existing `/api/specialists*` and `/api/roles`
  contracts, demo transport parity, keyboard access, no runtime semantics changes.

## Direction

- Page = one heading + segmented "Specialists | Custom Agents" tabs; each tab is a
  responsive card grid (`auto-fill, minmax(300px, 1fr)`), one card per agent.
- All technical configuration lives in a ~960px modal (header: identity + status badge
  + scope selector; body: Overview / Skills / Tools / MCP tabs; footer: dirty state +
  Reset / Cancel / Save). Header and footer fixed, body scrolls.
- Selection, scope, and tab state are frontend-local; the URL stays `/#agents`.
- Signature moment: the card's configuration badge (Built-in only / Customized /
  Needs attention) turning the grid into a live readiness board.

## Memorable moment

The customized-state badge derived from real saved data — configuration state is
visible without opening anything.

## Unresolved

None; composition pinned by the user brief.

## Direction contract

THESIS: the Agents page is a readiness board — one glance answers "what runs and
what is customized" — refusing the category-default two-pane config console.
OWN-WORLD: app tokens on light ground; hairline cards (10px radius, shadow-sm)
that lift 1px on hover; red accent only for customized/selected/focus states;
segmented tab control; 900px modal with fixed header/footer and scrolling body.
STORY: operators scan two card grids (Specialists | Custom Agents), read the
configuration badge, open a card, and adjust additions by scope inside the modal.
FIRST VIEWPORT: page heading + segmented tabs + 3–4 column card grid; primary
action (Create agent) lives inside the Custom tab's controls row.
FORM: user-pinned composition (brief); concept roll not applicable.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Finish note

Build completed and verified 2026-11-02: typecheck, eslint, 660 vitest tests,
production + demo builds, and the agents-surface e2e suite all pass. DOM audit
(`tests/e2e/agents-dom-audit.check.ts`) clean: contrast ≥ 4.5:1, focus rings,
tab semantics, dirty guards, modal mechanics, no overflow at 1440/1024/768/375.
Screenshots: `.impeccable/review/{desktop,desktop-modal,desktop-custom,mobile}.png`
(captured from the demo preview; this session's model could not view images, so
render review relied on the DOM audit and the e2e assertions). Detector: one
pre-existing app-wide `flat-type-hierarchy` warning, unchanged from baseline.
DESIGN.md: not written — this is an in-world redesign using the established app
world (no new tokens); durable system decisions live in the tokens themselves.

## Functional completion and polish — 2026-11-03

- Persona editor opens before loading optional tool references. A stalled or
  unavailable catalog cannot block creating a persona or erase its saved links.
  Required-name and API errors appear in the form; unsaved edits require confirmation.
- Real `/api/roles` CRUD persists name, description, `user_prompt`, enabled state,
  icon, tool links, and workflow preferences. The current Chat hides its legacy
  persona selector and has no persona-to-runtime execution adapter. The interface
  states this limitation; saving a persona does not register a specialist.
- Gallery retains rectangular cards and two tabs. Configuration badges use saved
  state. Scope uses the application select skin, including keyboard navigation;
  capability details expand on request. Overview reflects the current draft.
- Independent design and mechanical reviews found a specialist keyboard-focus
  defect, now fixed: loading keeps focus visible and closing returns to the card.
  Screenshots were visually inspected at desktop and mobile sizes; mobile agent
  dialogs use the existing sheet layer above the navigation drawer.
- Verification: 660 frontend unit tests, 280 API tests, 12 focused Playwright tests,
  frontend/API lint and typecheck, demo/production builds, and the DOM audit passed.
  Full unit suites used `--maxWorkers=4` to avoid local worker-contention timeouts.
  Real-stack Playwright verified create/edit/delete, instruction persistence after
  reload, the hidden Chat-selector limitation, specialist saving and scope switching.
  Test personas were removed and specialist additions restored after the check.
