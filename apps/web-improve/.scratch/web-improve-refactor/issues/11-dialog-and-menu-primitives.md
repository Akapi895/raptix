# 11: Dialog, drawer and menu interaction

**What to build:** Extract modal/drawer/menu behavior, including focus and dismissal, while retaining the shared confirmation and dirty-guard interfaces.
**Blocked by:** 10.
**Status:** ready-for-agent
**Owner:** Overlay primitives.
**Contract:** [execution.md](../execution.md).

- [ ] Modal/drawer trap focus, restore the trigger, label the dialog and respond to Escape/backdrop according to existing policy.
- [ ] Menu keyboard activation/dismissal and disabled items work; overlay composition does not lose confirmation reasons.
- [ ] Open/close/reset cycles remove listeners and avoid duplicate callbacks.
- [ ] Focused interaction tests and a real confirmation/unsaved-navigation exercise pass.
