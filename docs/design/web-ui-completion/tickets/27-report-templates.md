# 27: Report templates và matching preview

**What to build:** Operator chọn/sửa supported report template và preview dùng đúng snapshot/template revision khi render.
**Blocked by:** 26 — Immutable report snapshot jobs.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define typed template schema/allowed sections/style fields and version policy; avoid arbitrary executable templates.
2. Persist template revisions and selected default/override; preview binds immutable source+template identities.
3. Wire Settings template management và Reports selection/preview/save/conflict controls.
4. Render empty/long findings, tables, Unicode and referenced artifacts consistently; identify data omitted by template.
5. Retain older template references so existing reports stay reproducible.

## Acceptance criteria
- [ ] Saved template reloads and new report uses selected version.
- [ ] Preview source/template manifest matches rendering inputs.
- [ ] Unsafe/invalid/stale template rejected with usable field/conflict errors.

## Test / expected result
L13 preview/version switching with Vietnamese/tables/empty sections; competing template edit and old-report reopen. Existing artifact unchanged after template update.

## Completion evidence
Template/source revision manifest, preview/render comparison and validation/conflict outputs.
