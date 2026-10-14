# 10: Persist finding lifecycle and evidence authoring

**What to build:** Authorized users curate runtime suggestions, author findings,
attach retained evidence and progress findings through the real review/remediation
lifecycle with changes surviving refresh.

**Blocked by:** 06 (observed results/evidence reads), 07 (identity/roles).
**Status:** ready-for-agent
**Requirements:** R03-R05, R08-R10; write ownership approved in 01.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] New/edit finding and draft-import actions persist through the approved
  authority without overwriting producer evidence or treating AI claims as truth.
  Preserve parser quality and distinguish source observations from curated state.
- [ ] Server enforces draft/review/confirmed/remediation/retest/resolved transitions,
  role/context requirements, expected version and concurrent-edit conflicts.
- [ ] Evidence upload/link/inspect behavior retains opaque evidence identity,
  capture bytes/digest and producer lineage; masking/download permissions are
  server-owned. A finding ID is not a substitute for an evidence reference.
- [ ] Failed/denied/conflicting saves preserve form drafts and explain the failure.
  Dirty save/discard/cancel and Query invalidation reflect actual commits.
- [ ] Supported writes survive refresh/API restart, and foreign finding/evidence
  identities cannot cross engagement boundaries.

## Verification selection

Select finding transition/curation/concurrency and evidence integrity/access tests
plus changed form/detail/dirty-guard tests. Live smoke: import/create, attach
evidence, perform an allowed transition, then a role or stale-version refusal;
refresh and inspect retained bytes. Reuse unchanged parser/list/graph evidence
from 06; no reports/C2/full suite.

## Scope boundary

No replacement of the runtime knowledge/evidence subsystem. Add only the approved
Web workflow storage and bindings required for curation.
