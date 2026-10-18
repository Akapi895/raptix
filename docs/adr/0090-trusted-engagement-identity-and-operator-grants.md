# 0090. Trusted engagement identity, cancelled intents and operator grants

- **Status:** Accepted (2026-10-18; live acceptance in ledger 13.23)
- **Date:** 2026-10-18
- **Related:** [ADR-0086](0086-per-run-sandbox-workspace-isolation.md) (per-project sandbox), [ADR-0089](0089-pin-instance-delivery-and-controls-to-attempts.md) (instance controls), P10 and P11 plan.
- **Requester decision:** the requester approved the boundary, the grant semantics and the acceptance scope on 2026-10-18.

## Context

The web runtime is not pinned to one engagement (`RAPTIX_ENGAGEMENT: ''`). The OPPLAN
`add_objective` tool accepted an `engagement_name` from the model whenever no pin was set. The model copied
the display title from `roe.json` ("Popup Lab Assessment"), and that title replaced the workspace slug in thread
state. Two checks then disagreed: the bash fence (pin-only) refused every shell command, and the web context
validator refused every later run on that thread. Retry and reassign could not run at all.

## Decision

1. **Identity is trusted run configuration.** The web server's `configurable.engagement_name` is the workspace
   slug and is the run's identity. `state.engagement_name` is seeded from it and never written from model
   input. OPPLAN ignores a model-supplied `engagement_name`; the operator pin, when set, is the same value.
   The `roe.json` title stays a display value and never changes identity.
2. **Bash fence without a pin.** A run's engagement identity must be its own workspace slug, and the
   workspace must be exactly `/workspace/<slug>` or inside it. A run without an identity may use only the
   shared root `/workspace`. With a pin, the existing pin check still applies. The fence compares whole path
   components, not string prefixes alone. Ownership and context checks in `runtime-context.ts` are unchanged.
3. **Existing threads are not remapped.** A thread whose state already carries a display title keeps refusing
   new runs with the context mismatch. Acceptance uses a new thread.
4. **Cancelled intents are not reopened automatically.** A ledger row with outcome `cancelled` blocks any
   admission with the same fingerprint (role, objective, description), under any dispatch id. The block is by
   intent, not by role, so other work for the same objective is not locked.
   The same rule covers an attempt the runtime interrupted (a restart or a parent stop): a mailbox
   instance with the same fingerprint in state `interrupted` blocks the replayed task call with
   `interrupted_intent`. An intent the orchestrator rewrites is a new intent and is admitted as one.
5. **Operator grants are the only way to re-run a cancelled intent.** A Retry or Reassign of an ended attempt
   records an `OperatorGrant` in the instance mailbox with that attempt's persisted intent, objective and role.
   It is refused while the attempt runs or is cancelling, while another replacement is pending, and after a
   replacement has been consumed. The dispatch admitted for the grant's target id takes description, role and
   objective from the grant; model-written values are ignored. The grant is consumed when the replacement
   attempt starts, and withdrawn if the run is refused before admission. Ordinary admission checks (role,
   objective, ceilings, ROE and sandbox context) still run.
6. **Full intent is kept.** The persisted description is not truncated, so the replay fingerprint matches the
   original.

## Threat model

- **Model-authored identity.** The model could previously set the engagement a run is fenced to. It can no
   longer write `engagement_name` through OPPLAN, and the bash fence checks the identity against the run's own
   workspace. A model that names another engagement's slug is refused by the fence and by the context check.
- **Replay of a cancelled action.** A grant replays only the intent the operator cancelled, from the stored record,
   once, and only for the attempt it was issued against. The orchestrator cannot choose a different description
   or role through the grant.
- **Shared root.** Runs without an identity are limited to `/workspace` itself. They cannot reach another
   engagement's subtree.

## Consequences

- Runs without an identity that previously reached arbitrary `/workspace/<dir>` paths now refuse. In the web
  stack every run carries its slug, so this changes only unnamed CLI sessions.
- The mailbox schema gains a `grants` table through `CREATE TABLE IF NOT EXISTS`. No migration of existing rows.
- Retry no longer depends on the model reproducing a fingerprint. A grant whose replacement never started
  stays open until it is revoked or the same command is replayed.
