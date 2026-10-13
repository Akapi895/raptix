# 08d: Shell context ribbon and emergency stop controls

**What to build:** Extract the project context ribbon (`ContextRibbon`, `ProjectHeader`, eligibility badge, emergency-contact chip) and the Emergency Stop modal/banner into `src/shell/context-ribbon.tsx`, moved verbatim.
**Blocked by:** 08c.
**Status:** resolved
**Owner:** Layout composition; part of the ticket 08 split (umbrella: [08](08-shell-layout.md)).
**Contract:** [execution.md](../execution.md).

- [x] Emergency Stop button and emergency-contact chip remain rendered at 768/1024/1280/1440 widths in light/dark (structure + responsive classes preserved; visual audit stays with 62/63).
- [x] Stop gating (role, in-progress stop, no running operations), reason/ack validation and banner phases behave as before.
- [x] Leaf diff fits the cap (~220 runtime lines, ≤2 files); full check suite stays green.

## Evidence

- Commit `refactor(web-improve): shell context ribbon and emergency stop extraction (ticket 08d)`: `src/shell/context-ribbon.tsx` (ContextRibbon variants, ProjectHeader, EligBadge, EmergencyStop modal, StopBanner) moved verbatim.
- Rendered checks in `src/shell/shell.test.tsx`: emergency-stop button carries no responsive-hide variant (renders at 768/1024/1280/1440 alike), enabled for the manager persona; emergency-contact chip label spans (`max-2xl:hidden`/`2xl:hidden`) asserted in light and dark.
- At this leaf: typecheck clean, lint 222/0, 123/123 tests, build green.
