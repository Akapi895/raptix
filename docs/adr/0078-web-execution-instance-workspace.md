# Execution instance workspace

**Status: Proposed** · 2026-10-16

Execution composes a recipient-aware conversation and an instance panel. AI
instances are distinct from host agents, worker dependency nodes and C2 sessions.
The mock feature owns an `agent-workspace` aggregate inside the existing database
authority, scoped by actor/project/execution. All messages, drafts, questions and
control requests commit through that authority and publish ChangeSets. Browser
storage is a versioned recovery mirror, restored into the authority; it is not
an additional live store. Seed examples never assert real runtime capabilities.

Real mode reuses owned threads, request ledger, interrupts and SSE. Fleet branch
keys identify checkpoint observations within a thread, not proven live run
instances or independently addressable conversations. Such records remain
observe-only with parent/run attribution explicitly unknown. Direct messaging,
forwarding, per-instance pause/cancel/retry require separately reviewed runtime
contracts. Run cancellation retains its existing run scope and semantics.

This changes browser composition and mock presentation only. No runtime fan-out,
admission, authorization, handoff, preflight or cancellation contract changes.
