# 0017. Defer an inert per-role structure knob

- **Status:** Proposed
- **Date:** 2026-09-28
- **Related:** `docs/incalmo-lessons-implementation-guide.md` WP-L9

## Decision

Defer L9. `DECEPTICON_MODEL_PROFILE` selects the model tier, not agent-interface
structure. None of the presently in-scope work packages supplies a second
per-role interface structure to select; L1/L3, which could motivate that
choice, are explicitly out of scope pending sign-off and a T2 benchmark.
Introducing a no-op setting would expand config without an observable benefit.
Keep all role structures and defaults unchanged. Revisit only if a future
approved, in-scope alternative needs a per-role switch; then require a
default-preserving T0 test and flag-gated T1 replay before landing it.
