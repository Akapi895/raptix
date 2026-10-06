"""FROZEN acceptance thresholds — Wave T11 (pre-registered).

Frozen 2026-10-07, BEFORE any held-out evaluation result was opened, per
the plan's pre-registration discipline ("freeze acceptance thresholds ...
**before** opening held-out evaluation results in T11" — T0 step 5) and
the success-criteria section ("Thresholds are frozen after T0 baseline
variance estimation but **before** T11 held-out evaluation results are
opened").

Derivation basis (T0 variance only — no held-out result was consulted):

* ``capability_exposure_recall`` — the T0a/T0b captures are deterministic
  per commit (pinned surfaces, per-slot provenance; zero run-to-run name
  variance), so the only variance source is the availability probe. A
  0.05 non-inferiority margin over the 1.0 target absorbs a single
  probe flake while still failing any systematic filtering loss.
* ``forbidden_exposure_rate`` — 0.0 exactly: no threshold can justify
  exposing a scenario's forbidden tool; the recovery surface argument
  does not apply because every fixture's forbidden set excludes recovery
  tools.
* Tier A / Tier C pass rates — 1.0: these are deterministic correctness
  gates over raptix's own registry/adapter/parser code, not model
  behavior; any failure is a bug, not variance.
* ``task_success_proxy`` — the deterministic (policy-free) stand-in for
  ``task_success_rate``: required tools exposed AND no forbidden tool
  exposed. Floor 0.90 mirrors the live tier's floor.
* Live-LLM tiers (B and D) — frozen now so the numbers cannot be tuned
  after results exist: selection_precision >= 0.75,
  invalid_selection_rate <= 0.10, task_success_rate >= 0.90,
  bash_fallback_rate <= 0.20, discovery_latency <= 5 positions.
* ``SCHEMA_REDUCTION_RATIO_MIN`` — hypothesis H2 ("schema token cost
  decreases materially"), pinned at a 20% surface reduction as the
  materiality bar. Informational for the deterministic tier: it gates
  nothing on its own because H2 is validated on the live tiers.

Change control: any edit to these constants requires a plan-doc outcome
note explaining the new evidence, in the same commit.
"""

from __future__ import annotations

FROZEN_AT = "2026-10-07"

# ── Deterministic tiers (A: registry, C: executor) ─────────────────
TIER_A_PASS_RATE_MIN = 1.0
TIER_C_PASS_RATE_MIN = 1.0

# ── Exposure comparison (configs A/B/C vs scenario requirements) ───
CAPABILITY_EXPOSURE_RECALL_MIN = 0.95
FORBIDDEN_EXPOSURE_RATE_MAX = 0.0
DISCOVERY_LATENCY_MAX = 5  # position of the first required tool in the surface order

# ── Deterministic task-success proxy ───────────────────────────────
TASK_SUCCESS_PROXY_MIN = 0.90

# ── Frozen for the live LLM tiers (B: selection, D: end-to-end) ────
SELECTION_PRECISION_MIN = 0.75
INVALID_SELECTION_RATE_MAX = 0.10
TASK_SUCCESS_RATE_MIN = 0.90
BASH_FALLBACK_RATE_MAX = 0.20

# ── Hypothesis H2 (informational, validated on the live tiers) ─────
SCHEMA_REDUCTION_RATIO_MIN = 0.20
