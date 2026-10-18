# 0089. Pin instance delivery and controls to dispatch attempts

- **Status:** Proposed
- **Date:** 2026-10-18
- **Related:** [P10 implementation plan](../design/2026-10-17-web-ui-contract-completion-implementation-plan.md#p10--runtime-instance-identity-inboxhistory-và-controls), ADR-0077, ADR-0078, ADR-0086.
- **Requester decision:** the requester approved the three semantics below on 2026-10-18; the runtime/API design remains Proposed pending verification.

## Decision

The runtime owns the instance mailbox and command outcomes on the durable checkpointer volume. A recipient is `(threadId, dispatchId, attempt)`, never a role or checkpoint label. New instances record available run/parent attribution; legacy attribution stays unknown.

1. `accepted` means durable enqueue to that attempt. `delivered` means the recipient reached its model-call safe point. A provider failure leaves delivery pending for retry at the same attempt's next model boundary. `handled` means `model_turn_completed`, not execution success. Model-produced tool calls execute only after this boundary returns. Terminal/interrupted attempts disposition pending messages; nothing transfers automatically to a replacement attempt.
2. The caller retains a message/command ID through lost ACK and reconcile. Reusing an ID with another recipient or payload is a conflict. Forward is a new explicit message with a retained source-message reference, subject to source ownership and target lifetime checks.
3. Cancel is cooperative: record `cancel_requested`, reject further messages, and stop the child before its next model/tool admission. In-flight tools may finish. Only the dispatch boundary records the final observation. Cancel never cancels the parent or a sibling. Retry/reassign are explicit operator requests accepted only after the old attempt is terminal; the orchestrator invokes the normal dispatch/admission path for the replacement. Role changes never mutate a running graph.

Runtime HTTP uses `/_raptix/instances/{thread}/{dispatch}` with explicit attempts in message/control bodies. Fastify exposes these only through owned engagement/thread routes, rechecks operator/governance gates, and uses the existing run ownership/recovery ledger when starting an orchestrator turn for replacement admission. Runtime command acceptance is not execution admission or success; refusals and uncertain dispatches remain observable. Existing graph-question resume stays a separate operation with all parallel interrupts answered in one batch.

## Consequences

- Delivery is at-least-once until the model turn completes, with message-ID dedup; a failed model request cannot silently consume guidance. No replay across terminal attempts is permitted.
- A cancel ACK may precede termination by the duration of an in-flight tool. UI must display both requested and observed states.
- Replacement cannot bypass concurrency ceilings, terminal-intent policy, ROE/HITL/egress or per-run sandbox config. Unsupported/refused admission is a command outcome, not a successful replacement.
- Additive SQLite migration preserves historical mailbox records. New wire DTOs and nested validators live in `@raptix/web-contracts`. Controls are capability-driven; legacy instances do not acquire fictional control support.
- Verification selects mailbox/dispatch graph tests, crossing service/UI tests and actual runtime success/refusal/recovery. Missing acceptance keeps P10 open.
