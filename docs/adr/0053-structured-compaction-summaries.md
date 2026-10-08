# ADR-0053: Structured compaction summaries with reference validation

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0052 (transactional compaction); ADR-0049 (task state);
  ADR-0050 (execution receipts);
  `docs/context-optimization-implementation-plan.md` (WP-C2)

## Context

The compaction summary is free text. It can assert "completed" for work with no
persisted backing, cite a ledger action that never happened, or promote a
hypothesis to a fact — and the transactional gate (C1) cannot tell, because it
only checks structure and the recovery pointer. The safety-critical parts of a
summary (what was done, what it proved, what is still open) should cite
machine-checkable references instead of trusting prose.

## Decision

- **Structured section, appended.** When `RAPTIX_SUMMARY_STRUCTURED=1`, the
  raptix summarization slot appends a `## STRUCTURED_STATE` contract to the
  helper's summary prompt (the upstream `DEFAULT_SUMMARY_PROMPT` and its four
  base sections are untouched, per the plan). The contract asks for one fenced
  JSON block: `completed_work`, `evidence`, `failed_attempts`, `unresolved`,
  `hypotheses`.
- **Deterministic validator** (`intelligence/context/summary_contract.py`):
  - schema is a hard gate — the block must parse and every list must be
    present;
  - references are a hard gate — every `evidence` ref and every
    `completed_work` ref marked `evidence: true` must resolve against the
    objective's task-state evidence refs, a ledger action hash, or a readable
    workspace file (via the engagement-scoped backend);
  - a `failed_attempts` action hash must match a failed/unknown terminal ledger
    receipt, including when the ledger is empty (empty never means unrestricted);
  - a hypothesis re-used as a `completed_work` ref is rejected.
  - Missing/unreadable references fail validation; completed work requires a
    reference in the evidence section and unsupported "verified" fields are
    rejected. JSON sections, entry counts and bytes are bounded. Template JSON
    braces are escaped for LangChain's formatter. The per-call prompt includes
    the persisted revision, evidence refs and failed action hashes as sources.
- **Wired to the commit gate.** A validator failure is one of C1's
  pre-model validation reasons: the candidate never reaches the downstream
  model, the event is not committed and the uncompacted context is kept.
  Reference existence does not certify the semantic achievement of an objective;
  semantic fidelity is explicitly **not** a gate;
  an optional advisory LLM pass is out of scope.
- **Flag.** `RAPTIX_SUMMARY_STRUCTURED=1` (default off); off = free-text
  summary with only the C1/ADR-0046 structure and error checks.

## Threat model

The contract only *adds* citations to a summary the model already produces and
only *refuses* a commit on unverifiable references, so it cannot widen scope.
References are read through the engagement-scoped backend (ADR-0042 fence); no
new file is written by the validator. No guardrail, RoE, or KG write changes.

## Consequences

- **Easier:** committed summaries carry resolvable references; hypotheses and
  completed work are structurally separated.
- **Harder:** the model must emit a valid JSON block or compaction is refused
  (falling back to the uncompacted request, never data loss); prompt-policy
  changes are model-visible only when the flag is on.
- **Migration:** none. Flag off preserves the base prompt contract.

## Alternatives considered

- Make the structured fields mandatory for all runs — rejected: changes model
  input by default (plan §2.4); flag-gated.
- Use an LLM to judge fidelity as the gate — rejected: nondeterministic; kept
  advisory only.
- Embed references in the four base sections instead of a JSON block — rejected:
  harder to parse deterministically and risks perturbing the upstream contract.
