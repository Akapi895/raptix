# 08c: Header composition with notification/copilot slots

**What to build:** Extract the header composition (`Pop` popover, AI-mode status, workspace switcher, notices panel, profile menu, `Topbar`) into `src/shell/pop.tsx` + `src/shell/header.tsx`. The header exposes **named compatibility slots** — `notifications` (ticket 59) and `askAi` (ticket 60) — whose default implementations are the moved legacy components; later owners swap them via typed props instead of editing shared composition. Header wiring changes stay serialized with the integrator.
**Blocked by:** 08b.
**Status:** ready-for-agent
**Owner:** Layout composition; part of the ticket 08 split (umbrella: [08](08-shell-layout.md)).
**Contract:** [execution.md](../execution.md).

- [ ] Notifications/copilot keep mounting in their current positions with legacy behavior until 59/60 replace them; slot swap needs no shared-file edits.
- [ ] Header slots preserve existing behavior without duplicating store state (persona/theme/UI authorities stay in the shared stores via the legacy context).
- [ ] Leaf diff fits the cap (~265 runtime lines, ≤3 files); full check suite stays green.
