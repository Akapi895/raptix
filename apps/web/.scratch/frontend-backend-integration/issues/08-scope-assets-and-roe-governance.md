# 08: Persist scope, assets and ROE revisions

**What to build:** Authorized users maintain engagement scope and asset inventory,
submit ROE changes for independent review and see their immediate effect on
readiness and execution eligibility.

**Blocked by:** 07 (identity, roles and team).
**Status:** complete
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

## Evidence (2026-10-15)

- `ScopeService` + `/scope/revisions` and `/assets/inventory` routes: revisions
  persist version/diff/roe/requester/decision; submission supersedes the
  previously approved revision immediately (invalidation at submission, per
  acceptance) and audits every mutation. Decisions enforce reviewer role +
  `requireIndependentActor` (self-review refused server-side).
- Assets: operator adds/imports stay `pending`; `in_scope` classification is
  refused (409) unless an approved revision's diff covers the identifier (or
  the engagement's own authorized target). Narrowing (out_of_scope) is always
  allowed. Graph-observed assets (ticket 06) are untouched by these writes.
- Edited ROE windows/emergency contacts persist on the revision; the approved
  revision feeds runtime readiness through `roeWindowAllows` (consumed by 09).
- Tests: `server/tests/t08-scope.test.ts` (4) — submit/approve/supersede,
  self-review + role refusal, pending-until-approved asset flow, foreign 404 +
  malformed windows. Web: Scope & ROE tab wired into project detail.
- Named gap: no live runtime smoke in this slice (its consumers land in 09's
  preflight/execute gate and 18's deployment probe).
