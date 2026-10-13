# 35: Section editor and report preview

**What to build:** Migrate report sections, eligible finding selection, per-section save/dirty guard and formatted preview to typed handlers/read models.
**Blocked by:** 34.
**Status:** ready-for-agent
**Owner:** Report authoring and section-save handlers.
**Contract:** [execution.md](../execution.md).

- [ ] Save/cancel/error behavior preserves section drafts; navigation warns before losing unsaved edits.
- [ ] Invalid finding selections and editing locked approved content are rejected by handlers as well as UI.
- [ ] Preview represents selected version/sections accurately and adds no report-preview checksum feature.
- [ ] Editor/preview route tests cover failures and role/read-only states; review/delivery remain bridged for later owners.
