# 08: Persist scope, assets and ROE revisions

**What to build:** Authorized users maintain engagement scope and asset inventory,
submit ROE changes for independent review and see their immediate effect on
readiness and execution eligibility.

**Blocked by:** 07 (identity, roles and team).
**Status:** ready-for-agent
**Requirements:** R03-R05, R08-R10; decisions D2/D3.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Scope/project panels and asset list/detail/import/classification read and
  write real owned records. Separate operator-managed scope from graph-observed
  assets; retained runtime evidence is not overwritten by Web edits.
- [ ] A revision has a persisted version/diff/requester and approval decision.
  Independent review and conflict handling are server-enforced. Newly added
  targets remain pending until the approved governance path accepts them.
- [ ] Invalidation happens at revision submission, not postponed until approval:
  dependent approvals/readiness are made stale using the binding contract in 01;
  downstream plans/operations consume that authoritative version in 09.
- [ ] Preserve the chosen last-approved-scope behavior for running activity;
  pending assets cannot become executable targets by editing frontend state.
- [ ] Edited time windows/timezones, emergency contacts and other ROE essentials
  persist and feed runtime readiness. Required independent-approval behavior is
  enabled only after 07 supplies the necessary identity model.

## Verification selection

Select scope/asset import/classification, version/conflict/invalidation and
independent-review tests at the real enforcement site. Live smoke: import an
asset, submit a scope revision, observe pending/refused access, decide it and
refresh. Include an edited/narrowed window case. Reuse unchanged general auth/
project tests; test only affected consumers of version changes. No full suite.

## Scope boundary

Do not rewrite runtime egress/ROE controls. Persisted business plan execution and
preflight are integrated by 09; this ticket provides their scope/version inputs.
