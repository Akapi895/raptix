# 14: Connect tradecraft library and observed analysis

**What to build:** Users inspect actual playbooks/techniques, review supported
revisions independently and analyze engagement technique coverage and paths
derived from observed execution/evidence.

**Blocked by:** 06 (observed results/graph reads), 08 (scope governance).
**Status:** ready-for-agent
**Requirements:** R03-R05, R08-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Library/detail/technique views resolve the approved corpus/runtime concepts
  through public contracts. Keep skill corpus data and runtime execution logic
  under their existing owners rather than creating a second browser corpus.
- [ ] Required revision submission/diff/review/version behavior persists and
  rejects self-review on the server. A displayed technique does not become
  executable merely because it is in the library.
- [ ] Coverage, heatmap and attack-path views use defined observed sources and
  source-quality/missing-data states. No inferred execution or detection is
  fabricated when records are absent.
- [ ] Library changes and scoped analysis reads invalidate the correct views and
  survive refresh where persistence is part of their contract.
- [ ] Required library/analysis functionality follows 01's parity scope, with
  unavailable sources treated explicitly rather than replaced with demo records.

## Verification selection

Select library/version/review and analysis/provenance projection tests plus the
affected routes. Live smoke: technique/library read, supported independent review
and observed analysis, then self-review or missing-source refusal. Run corpus or
Python checks only if those owning sources change; reuse unchanged graph reads
from 06. No full suite or automatic skill-graph rebuild for a browser-only edit.

## Scope boundary

No unrequested corpus rewrite, technique execution feature or new chart library.
Capability availability remains separate from invocation authorization.
