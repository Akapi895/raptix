# Fresh owned thread context bootstrap

Status: accepted for W07 (2026-10-02).

## Observed failure

An actual background Soundwave run received authorization_confirmed=true in trusted
configurable and completed successfully, but persisted authorization_confirmed=false
on state. The boolean reducer channel initializes to false; EngagementContext's
hydration intentionally copies authorization only when the existing value is None.
This makes a fresh default false indistinguishable from an explicitly persisted
false, and the web's strict reuse check correctly refused the resulting checkpoint.

## Decision

Create a new runtime thread using the installed API/SDK's `supersteps` facility,
initializing only trusted engagement state at `__start__`. Values come from persisted
owner-scoped project metadata and explicit server topology, never browser input.
The runtime still receives the same configurable on every background run. Run input
remains messages-only. sandbox_url stays config-only because it is not a hydration
state channel.

This operation is inseparable from new thread creation, uses a server-generated
candidate ID and `if_exists:raise`, and never updates an existing thread's state.
An ACK-loss reconciliation verifies the stored candidate's metadata and full context
proof rather than replaying create/update. Existing false authorization, foreign
context, stale topology or missing proof remain conflicts; no migration upgrades
old thread authority and no resume command.update/goto is exposed.

## Threat model / guard preservation

Browser attempts to submit state/config/authorization are rejected by the HTTP
allowlist. The service checks persisted authorization before creation and rechecks
the project context hash when binding the returned resource. A target change during
the remote creation window refuses binding and retains uncertainty. Runtime create
with a duplicate ID rejects instead of mutating another thread. No RoE, SafeCommand,
egress, HITL, middleware slot or Python runtime code is disabled or changed. This
supplies the existing guard path with its intended trusted initial context; it does
not convert false authorization on an existing thread into true.

Evidence: failing actual-run checkpoint capture in w07-hydration-failure.json,
failing controlled default-false regression followed by the bootstrap fix, and the
successful actual-runtime gate recorded in w07-live.json. Once runtime channel
initialization can distinguish absent from false, this bootstrap can be revisited
with the same producer/live regression gates.
