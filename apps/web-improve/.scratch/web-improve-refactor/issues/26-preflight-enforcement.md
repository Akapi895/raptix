# 26: Eight preflight checks and execution eligibility

**What to build:** Extract deterministic preflight policy and make real preflight/start eligibility use it, including the source's missing time-window enforcement and validity checks for required plan approvals.
**Blocked by:** 25, 21.
**Status:** ready-for-agent
**Owner:** Operation preflight/eligibility domain interface.
**Contract:** [execution.md](../execution.md).

- [ ] Preserve the eight source check identities; each failure has an observable reason/fix link and cannot pass the execution gate.
- [ ] Project/ROE/target/playbook/agent/required-approval/contact checks validate current canonical records, including cross-project or missing IDs.
- [ ] Time-window tests cover allowed time and before/after boundaries in project timezone; manual planless operations remain allowed only where documented policy permits.
- [ ] Linked plan approval is rejected at its recorded deadline; 39 owns assigning a new 24h deadline. Real policy tests and rendered preflight integration are separate.
