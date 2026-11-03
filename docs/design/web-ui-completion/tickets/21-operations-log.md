# 21: Operations Log pagination/export/provenance

**What to build:** Operator tìm/lọc/xem/export đúng operational events đã retained, không chỉ stream đang active.
**Blocked by:** 06 — Durable tool activity replay.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Reuse durable public event seam; map runtime/checkpoint/workspace/provider sources without invented run attribution.
2. Define scoped filter/pagination/export snapshot semantics with stable cursors and explicit limits.
3. Wire source/kind/time/thread/search controls and live refresh; preserve selection/cursor on new events.
4. Stream/export authorized selected rows with source/truncation metadata and redaction.
5. Show invalid cursor, unavailable history and partial export clearly; disable no-op controls.

## Acceptance criteria
- [ ] Reload retains event order/identity and no duplicate live/history entries.
- [ ] Export agrees with documented filters/snapshot and excludes foreign/private data.
- [ ] Empty versus unavailable versus truncated outcomes distinguishable.

## Test / expected result
L10 real mixed events and exported rows, invalid cursor/time ranges, new event during pagination and foreign engagement requests. Repeat same export snapshot yields equivalent record identities.

## Completion evidence
Filter/export contract, event-ID comparison, downloaded sanitized export and UI pagination/refresh trace.
