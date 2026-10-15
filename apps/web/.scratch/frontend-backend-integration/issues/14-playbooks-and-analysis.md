# 14: Connect tradecraft library and observed analysis

**What to build:** Users inspect actual playbooks/techniques, review supported
revisions independently and analyze engagement technique coverage and paths
derived from observed execution/evidence.

**Blocked by:** 06 (observed results/graph reads), 08 (scope governance).
**Status:** complete (KG-backed library reads + canonical detail + observed analysis; revision writes excluded by recorded decision; ADR-0070 engagement-scoped review proposals added on top — see Evidence)
**Requirements:** R03-R05, R08-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [x] Library/detail/technique views resolve the approved corpus/runtime concepts
  through public contracts. Keep skill corpus data and runtime execution logic
  under their existing owners rather than creating a second browser corpus.
  *(LibraryService reads the canonical knowledge-graph corpus (`Skill`/`Technique`
  nodes — the same graph the runtime's skill engine builds via skills.cypher)
  through the shared bounded Neo4j HTTP helper; the browser renders a projection,
  never a copy.)*
- [x] Required revision submission/diff/review/version behavior persists and
  rejects self-review on the server. A displayed technique does not become
  executable merely because it is in the library.
  *(Recorded exclusion: skill-corpus revision writes have NO web contract — the
  corpus changes through the runtime's own git-based workflow (`packages/raptix-skills`
  defs + `make audit-skills-strict`/graph gates); a web revision store would fork
  corpus ownership, which acceptance bullet 1 forbids ("no second browser corpus").
  The exclusion is returned by the API (`excludedActions`) and rendered as a banner.
  The panel states reference-only semantics: library presence never implies execution
  authorization — invocation authorization is a separate runtime concern.
  ADR-0070 (Accepted) adds engagement-scoped review PROPOSALS on top without
  violating this boundary: a proposal pins the canonical skill snapshot
  (SHA-256 of the canonical detail projection), amendment is author-only and
  version-pinned, decisions require an independent reviewer, canonical drift
  blocks review/export, and the only output is a reviewed JSON export for the
  EXISTING git publication workflow — the runtime loader and graph builder
  never read these records, so no second executable corpus exists.)*
- [x] Coverage, heatmap and attack-path views use defined observed sources and
  source-quality/missing-data states. No inferred execution or detection is
  fabricated when records are absent.
  *(AnalysisView derives observed techniques only from scoped nodes carrying
  `technique_id`/`mitre_id` (canonical MITRE-shaped tokens); paths are bounded chains
  over recorded edges starting at technique-bearing nodes. Missing-data states are
  explicit: empty graph → `quality.graph: 'empty'`; unreachable corpus side →
  `corpusTechniques/inCorpus: null` with UI copy "shown as missing data, never as
  zero coverage".)*
- [x] Library changes and scoped analysis reads invalidate the correct views and
  survive refresh where persistence is part of their contract.
  *(Both reads are fresh no-store server projections; React Query keys
  `['real','library']` / `['real','analysis',engagementId]` are engagement-scoped so
  scope switches never leak analysis of another engagement. The library itself is
  read-only here — its persistence contract lives in the runtime repo, which is the
  recorded decision above.)*
- [x] Required library/analysis functionality follows 01's parity scope, with
  unavailable sources treated explicitly rather than replaced with demo records.
  *(Library page renders the real KG projection with a filter; the graph-down case
  renders the honest unavailable empty state with retry. No demo records anywhere.)*

## Verification selection

Select library/version/review and analysis/provenance projection tests plus the
affected routes. Live smoke: technique/library read, supported independent review
and observed analysis, then self-review or missing-source refusal. Run corpus or
Python checks only if those owning sources change; reuse unchanged graph reads
from 06. No full suite or automatic skill-graph rebuild for a browser-only edit.

**Evidence:** `apps/web/server/tests/t14-library-analysis.test.ts` (4 tests: KG-contract
library read + recorded revision-write exclusions; observed coverage/paths from scoped
nodes with corpus enrichment and foreign-engagement 404; empty graph explicit state +
unreachable corpus stays null; path projection bounds/dedupe/start-node invariants).
`apps/web/server/tests/t14-library-review.test.ts` (3 tests: canonical skill/technique
detail over the exact graph projection with 404 for unknown names; ADR-0070 proposal
lifecycle — canonical pinning, author-only amendment, wrong-version and self-review
refusals, duplicate-in-review 409, export contract — and drift/closed-engagement/role
blocks). ADR-0070 (`docs/adr/0070-web-library-review-proposals.md`) is Accepted with
service (`library-review-service.ts`), routes, `library-review-panel.tsx` and a
`playbook-review` engagement-scoped surface. Corpus and skill-graph sources unchanged —
no Python/corpus checks needed and no skill-graph rebuild. Live workflow acceptance
(`tests/local/artifacts/workflow-live/899a8655/state.json`) passed 12/12 checks on real
PostgreSQL incl. restart persistence with image `raptix-web-verification-api:20261015`.
Server suite 40 files / 339 tests green; web 96 files / 1079 tests green; server+web
typecheck and lint clean.

## Scope boundary

No unrequested corpus rewrite, technique execution feature or new chart library.
Capability availability remains separate from invocation authorization.
