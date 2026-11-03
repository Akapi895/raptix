# Architecture Decision Records

This directory contains the **Architecture Decision Records** (ADRs) for
Raptix — short, numbered, append-only documents that capture
non-obvious architectural decisions, their context, and their
consequences.

## When to write one

Write an ADR when the answer to "why is the code shaped this way?"
needs to be available to a future maintainer (human or AI) who was not
in the room when the decision was made. Concretely:

- A trade-off between two viable designs where the loser is not
  obviously bad (e.g. middleware composition order, sandbox transport
  mechanism, C2 framework selection, prompt-cache boundary placement).
- A constraint that the code relies on but does not test (e.g. an
  invariant about which services share a Docker network).
- A reversal of a previous decision — the old ADR is marked
  `Superseded` and the new one explains why.
- A policy that governs how the project is operated (e.g. which merge
  and release gates exist, the AI-assisted contribution charter).

Do **not** write an ADR for:

- Decisions that are obvious from reading the code.
- Bug fixes that do not change architecture.
- Style or formatting decisions (the project's lint config is the
  source of truth).
- Feature scoping (open an issue).

## Format

Each ADR follows the [Michael Nygard format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):

1. **Title** — short, imperative, present tense.
2. **Status** — `Proposed` / `Accepted` / `Deprecated` / `Superseded by ADR-NNNN`.
3. **Context** — the forces at play; what makes this decision non-obvious.
4. **Decision** — what we are doing.
5. **Consequences** — what becomes easier, what becomes harder, what is
   given up.
6. **Alternatives considered** — the designs that lost, with one
   sentence each on why.

Use [`template.md`](template.md) as the starting point.

## Lifecycle

- Numbered sequentially, four digits, never renumbered: `0001-...`,
  `0002-...`. The number is allocated when the PR opens; if your draft
  PR sits for a while and another ADR lands first, renumber yours.
- File name kebab-case, derived from the title: `0007-c2-framework-selection.md`.
- Append-only. To change a decision, write a new ADR that supersedes
  the old one; do not edit the old one except to flip its `Status` to
  `Superseded by ADR-NNNN`.
- Anyone may open an ADR. Landing one at `Status: Accepted` is a
  maintainer decision, by convention rather than by a branch rule — see
  [ADR-0012](0012-retire-codeowners-merge-gate.md) for why the repo no
  longer enforces per-path review.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-pr-tiering-and-blast-radius.md) | PR tiering by blast radius | Superseded by 0012 |
| [0003](0003-ai-contributor-self-review.md) | AI-assisted contribution self-review charter | Accepted |
| [0004](0004-zero-ai-slop-policy.md) | Zero AI-slop policy — the 100% quality bar | Accepted |
| [0005](0005-bloodhound-via-bhce-rest-client.md) | Integrate BloodHound via the official BHCE REST API, not via in-house reimplementation | Accepted |
| [0006](0006-agent-driven-container-lifecycle.md) | Agent-driven domain-tool container lifecycle via an ops-control sidecar | Proposed |
| [0007](0007-ai-surface-technology-node.md) | Add a Technology KG node kind for AI-surface / tech-detection signals | Accepted |
| [0008](0008-skillogy-hard-acl-phase1a.md) | Skillogy hard path-prefix ACL (Phase 1a) | Accepted |
| [0009](0009-hitl-langgraph-native-migration.md) | Migrate HITL to LangGraph-native `interrupt()` + explicit-policy sets | Proposed |
| [0010](0010-open-web-acquisition.md) | Acquire open-web content with a sandbox-side, RoE-gated fetch engine | Proposed |
| [0011](0011-skillogy-lightrag-hybrid-retrieval.md) | Skillogy find_skill uses LightRAG-style hybrid retrieval over the existing graph | Proposed |
| [0012](0012-retire-codeowners-merge-gate.md) | Retire the CODEOWNERS merge gate; keep required CI and the release environment | Accepted |
| [0013](0013-fail-safe-kg-autoingest.md) | Make KG auto-ingest fail-safe after tool execution | Proposed |
| [0014](0014-observational-tried-edge-ledger.md) | Record tried edges observationally | Proposed |
| [0015](0015-defer-structured-decoding.md) | Defer structured decoding | Proposed |
| [0016](0016-ingest-gobuster-directory-results.md) | Ingest Gobuster directory results | Proposed |
| [0017](0017-defer-per-role-structure.md) | Defer an inert per-role structure knob | Proposed |
| [0018](0018-recon-surface-inventory.md) | Normalize reconnaissance into a KG surface inventory | Accepted |
| [0019](0019-parameterize-surface-exploit-cells.md) | Parameterize surface exploitation by coverage cell | Proposed |
| [0020](0020-coverage-matrix-objectives.md) | Derive Initial Foothold coverage from the KG into OPPLAN children | Proposed |
| [0021](0021-b0-session-isolation-gate.md) | Gate surface-exploit fan-out on session isolation | Proposed |
| [0022](0022-sequential-surface-exploit-dispatch.md) | Dispatch surface-exploit cells sequentially | Proposed |
| [0023](0023-bounded-iterative-surface-reexpansion.md) | Bound iterative surface-exploit re-expansion | Proposed |
| [0024](0024-code-owned-surface-reexpansion-bounds.md) | Wire bounded re-expansion into KG surface inventory | Proposed |
| [0025](0025-surface-exploit-chained-surface-provenance.md) | Record chained surface provenance on confirmation | Proposed |
| [0026](0026-bounded-parallel-surface-fanout.md) | Bound parallel surface-exploit fan-out | Proposed |
| [0049](0049-evidence-model-extends-capability-contract.md) | Evidence modeling extends the capability-layer Observation contract; AKG redesign and Exploration Planner are deferred | Proposed |
| [0060](0060-project-recorded-claims-through-existing-kg-context.md) | Project recorded claims through the existing KG summary | Proposed |
| [0061](0061-retain-and-inspect-scanner-captures.md) | Retain scanner captures and inspect their source consistency | Proposed |
| [0062](0062-differential-verification-over-retained-captures.md) | Differential verification over retained captures | Superseded by 0063 |
| [0063](0063-bounded-recorded-verification-context.md) | Bounded recorded verification context on the existing KG summary | Proposed |
| [0064](0064-evaluate-evidence-informed-decisions-with-replay.md) | Evaluate evidence-informed decisions at replay checkpoints | Proposed |
| [0065](0065-tolerate-enveloped-json-in-decision-scoring.md) | Tolerate enveloped JSON in decision scoring | Proposed |
| [0066](0066-bind-decision-output-to-consumed-provenance.md) | Bind decision output to consumed provenance | Proposed |
| [0085](0085-single-operator-planning-scope.md) | Approve the planner's scope at the handoff for single-operator engagements | Proposed |
| [0086](0086-per-run-sandbox-workspace-isolation.md) | Per-run workspace isolation replaces the single-engagement sandbox pin | Proposed — revision required |
| [0098](0098-controller-lease-for-c2-sessions.md) | Give each interactive C2 console one controller at a time through a time-limited lease | Proposed |
| [0099](0099-runtime-c2-dispatch-through-web-ledger.md) | Dispatch agent C2 commands through the web command ledger so each command names its run | Proposed |
| [0103](0103-verified-poc-gate-for-workspace-findings.md) | A workspace finding is confirmed only by a separate verifier that re-runs its sealed Proof of Concept | Proposed |
| [0104](0104-reproduce-sealed-poc-from-the-console.md) | An operator reproduces a finding's sealed Proof of Concept from the console, and a reproduction never writes a verdict | Proposed |
| [0105](0105-webshell-provider-and-single-operator-sessions.md) | A WebShell session is a typed request/response provider, and direct use requires single-operator mode | Proposed |

Keep this index in sync when you land a new ADR. (Rows 0027–0048 are missing
from this index as pre-existing drift, not introduced by ADR-0049 — the files
exist under `docs/adr/`; backfilling them is a separate cleanup.)
