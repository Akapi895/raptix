# 31: Findings inventory and detail reads

**What to build:** Migrate findings list/detail reads, severity breakdowns, history and linked evidence through typed services, retaining mutation compatibility until 32.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Finding read models and evidence-tab presentation.
**Contract:** [execution.md](../execution.md).

- [ ] Search/severity/status filters/pagination/counts reflect scoped canonical records, including AI suggestions as proposals.
- [ ] Detail history/metadata and evidence list apply role-sensitive masking and not-found/forbidden handling.
- [ ] Evidence references remain opaque; UI does not present recorded claims as proven exploitability.
- [ ] Existing create/review links remain functional via the bridge; a legacy status change updates the new views.
