# 32: Finding forms, lifecycle and AI draft import

**What to build:** Migrate finding create/edit/review/remediation/retest transitions and attachment actions to validated forms and real scoped handlers.
**Blocked by:** 31.
**Status:** ready-for-agent
**Owner:** Finding lifecycle/write handlers.
**Contract:** [execution.md](../execution.md).

- [ ] Draft → review → confirmed → remediation → retest → resolved and return paths enforce current role/state policy at the handler.
- [ ] Forms validate severity/technique/evidence, track dirty state and preserve drafts on submission failure.
- [ ] AI suggestions import as drafts only; evidence attachment checks compatible project scope and masking.
- [ ] Report/project/legacy consumers observe transitions; baseline proposal regressions stay green with new refusal cases.
