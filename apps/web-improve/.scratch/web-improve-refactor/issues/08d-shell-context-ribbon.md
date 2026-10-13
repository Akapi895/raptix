# 08d: Shell context ribbon and emergency stop controls

**What to build:** Extract the project context ribbon (`ContextRibbon`, `ProjectHeader`, eligibility badge, emergency-contact chip) and the Emergency Stop modal/banner into `src/shell/context-ribbon.tsx`, moved verbatim.
**Blocked by:** 08c.
**Status:** ready-for-agent
**Owner:** Layout composition; part of the ticket 08 split (umbrella: [08](08-shell-layout.md)).
**Contract:** [execution.md](../execution.md).

- [ ] Emergency Stop button and emergency-contact chip remain rendered at 768/1024/1280/1440 widths in light/dark (structure + responsive classes preserved; visual audit stays with 62/63).
- [ ] Stop gating (role, in-progress stop, no running operations), reason/ack validation and banner phases behave as before.
- [ ] Leaf diff fits the cap (~220 runtime lines, ≤2 files); full check suite stays green.
