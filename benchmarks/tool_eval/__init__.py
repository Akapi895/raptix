"""Tool-eval harness — Waves T11+ of docs/tool-optimization-implementation-plan.md.

Tiers A (registry correctness) and C (executor chain) are deterministic
and computed numerically; tiers B (tool-selection) and D (end-to-end)
need a live LLM policy/stack and report PENDING until one runs — never
fabricated. See :mod:`benchmarks.tool_eval.evaluate` for the tier and
ablation-config definitions, :mod:`benchmarks.tool_eval.thresholds` for
the pre-registered acceptance gates.
"""
