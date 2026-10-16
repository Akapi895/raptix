# 09: Console interaction completion

**What to build:** Console hỗ trợ brief dài, Markdown, keyboard, grouped detail và scroll trong mọi lifecycle state.
**Blocked by:** 04 — Q&A/status; 06 — Tool replay; 08 — Reasoning transport.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Inventory composer/question/tool/confirmation controls; replace single-line limitation with multiline behavior and explicit Enter/Shift+Enter rule.
2. Finish semantic Markdown styling for tables, fenced code with/without language, links and long Vietnamese text; no raw HTML execution.
3. Keep group open state/scroll anchor stable through streaming/history merges; pin only near bottom, accessible Jump to latest.
4. Wire truthful busy/cancel/recovery/error/empty states and keyboard focus across question panel/CONFIRM.
5. Remove prototype reliance from production control paths; retain separate mock regression baseline.

## Acceptance criteria
- [ ] Multiline brief send once, Enter/Shift+Enter policy works and is visible.
- [ ] Group toggles/Markdown/no-language code readable; user scroll-up is not overridden.
- [ ] Pending/busy/conflict controls do not accidentally submit twice or hide failure.

## Test / expected result
L03–L06 and cross-cutting keyboard/mobile matrix; real streaming run plus long protocol fixture. Reload preserves authoritative history while selection/scroll follows documented UI policy.

## Completion evidence
Desktop/mobile traces, semantic render assertions, keyboard flow and no-page-error live run.
