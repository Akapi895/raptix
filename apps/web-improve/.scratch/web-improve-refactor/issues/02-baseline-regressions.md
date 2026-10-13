# 02: Characterize existing safety behavior

**What to build:** Baseline behavioral regressions at the current store/helper/UI execution sites. Record missing enforcement against its target owner instead of requiring ten future invariants to pass through the store today.
**Blocked by:** 01.
**Status:** ready-for-agent
**Owner:** Baseline suite and execution-site adapters.
**Contract:** [execution.md](../execution.md).

- [ ] Working preflight, stop outcomes, scope invalidation, facets, proposal and isolation paths have meaningful allowed/denied regressions.
- [ ] UI-owned four-eyes/grant-watch behavior is exercised with the relevant screen/hook mounted; fake timers precede the export's clock import.
- [ ] The 6-role × 19-action baseline covers membership and closed/cancelled contexts; expected values come from documented policy, not calling the same implementation twice.
- [ ] Missing deadline/time-window/action enforcement is recorded in the execution ledger with owning tickets; no skipped/xfail tests or false baseline-green claims are shipped.
