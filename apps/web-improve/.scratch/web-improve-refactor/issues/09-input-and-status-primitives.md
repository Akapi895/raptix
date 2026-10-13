# 09: Input, button and status primitives

**What to build:** Extract buttons, text/select/check/toggle inputs and status/severity presentation from the legacy UI module in bounded groups, preserving compatibility exports and tokens.
**Blocked by:** 08e (completion leaf of the split ticket 08 shell layout extraction; umbrella [08](08-shell-layout.md)).
**Status:** ready-for-agent
**Owner:** Input/status primitives.
**Contract:** [execution.md](../execution.md).

- [ ] Existing props, disabled/loading/reason behavior and status mappings remain compatible.
- [ ] Labels, invalid/required states and keyboard operation are preserved in light/dark mode.
- [ ] Shared input/status definitions have one implementation; remaining legacy consumers use forwarding exports.
- [ ] Group extraction uses explicit sub-leaves when file/line estimates exceed the cap; test interaction/state behavior rather than render-only snapshots for every primitive.
