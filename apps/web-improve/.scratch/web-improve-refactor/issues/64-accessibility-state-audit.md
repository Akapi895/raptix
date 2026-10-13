# 64: Accessibility, announcements and state audit

**What to build:** Verify keyboard/focus/loading/empty/error behavior already owned by each feature; complete bounded shared route/toast/status announcement wiring.
**Blocked by:** 63.
**Status:** ready-for-agent
**Owner:** Shared accessibility announcements and audit.
**Contract:** [execution.md](../execution.md).

- [ ] Critical flows support logical focus, Enter/Space/Escape and dialog focus restore; graph/SVG controls are labeled and keyboard-operable.
- [ ] Route changes/toasts/status transitions are announced without duplicate live-region output.
- [ ] Each page/list has loading/empty/error handling and a feature boundary isolates crashes.
- [ ] Remaining feature defects become budgeted blocking leaves; audit completion includes actual browser evidence.
