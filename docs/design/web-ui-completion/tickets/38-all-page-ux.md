# 38: All-page accessibility/responsive acceptance

**What to build:** Mọi supported interaction của 13 trang dùng được bằng keyboard/mobile và có state loading/error/conflict/recovery thật.
**Blocked by:** 09,13,14,18,19,20,21,24,25,28,29,30,31,32,33,35,36,37 — các local UI workflows cần được nghiệm thu.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Build per-page control inventory mapping every button/form/toggle/menu to actual behavior/API/result; flag no-op/demo-only controls.
2. Verify loading/empty/partial/unavailable/validation/conflict/busy/recovery states for each supported action.
3. Complete keyboard focus/dialog/Escape/ARIA/status announcements and narrow-screen sidebar/composer/table handling.
4. Exercise long-history/render/scroll and route-switch/late-ACK cases across real pages.
5. Remove production prototype dependency; keep separate visual/mock regression where intentionally supported.

## Acceptance criteria
- [ ] Exactly 13 sidebar entries; no supported action relies on mock timer/success toast alone.
- [ ] Keyboard/mobile matrix passes without inaccessible confirmation or horizontal layout break.
- [ ] Error/disabled states name real reason; no silent fixture fallback.

## Test / expected result
TEST-PLAN cross-cutting matrix at 390×844, 768×1024, 1440×900 plus native happy/error cases. Accessibility automation supplements keyboard/manual browser observation, not replaces it.

## Completion evidence
Control coverage matrix, per-page traces/screenshots and identified/resolved interaction failures.
