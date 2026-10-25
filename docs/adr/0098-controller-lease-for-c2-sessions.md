# ADR-0098: Give each interactive C2 console one controller at a time through a time-limited lease

- **Status:** Proposed — 2026-10-23. Not accepted; the repository owner decides.
- **Date:** 2026-10-23
- **Deciders:** repository owner (pending)
- **Related:** ADR-0095 (interactive C2 console; its single-controller decision and its open lease timeout), ADR-0036 (typed
  Sliver bridge; single-shot execution and its uncertain-outcome rule), ADR-0099 (agent dispatch through the web ledger),
  `GLOSSARY.md` (controller, controller lease, interactive console)

## Context

ADR-0095 requires one controller per interactive console, a lease recorded in PostgreSQL, and operator takeover from an
agent. A database constraint alone cannot stop an old input already travelling to the bridge. The decision must cover the
provider-side fence, missed heartbeats and recovery when the database and bridge disagree.

Single-shot commands keep ADR-0036's grant and command-ledger semantics; they do not acquire a PTY lease. This decision
does not authorize a second PTY to evade a console's controller. ADR-0099 defines run identity and the protocol for an
agent acting under an operator's access; the PTY proposal defines input records and transport bounds.

## Decision

1. **One console, one writer.** At most one nonterminal console exists for an owned provider session, regardless of holder.
   The console binds the provider's stable session identity, not just a host label. `ControllerLease` contains `id`,
   `engagementId`, `sessionId`, `consoleId`, `holderKind`, `holderId`, `actingOperatorId`, `grantId`, `epoch`, `state`
   (`pending`, `active`, `ending`, `ended`), `acquiredAt`, `lastHeartbeatAt`, `expiresAt`, `endedAt`, `endReason`.
   Operator `holderId` is a trusted user id; agent `holderId` is the authorizing run id under ADR-0099. Grant/holder/console
   scope must agree. A partial unique index on `consoleId` where `endedAt IS NULL` covers pending and ending leases too.
2. **Bounded lifetime.** TTL is 45 seconds, heartbeat interval 15 seconds, measured using server time. Effective expiry is
   the earliest of heartbeat + TTL, the selected grant expiry and any finite ROE-window deadline. Renewal rechecks current
   membership, grant, scope/window, stop state, console/session and, for agents, active run/delegation. A heartbeat after
   expiry, ending or takeover cannot resurrect a lease. API admission and the bridge check deadlines on every mutation;
   a server-owned sweeper finalizes expired records without a mounted UI. Measure browser throttling, clock skew and
   reattach latency at the native gate; clock uncertainty fails closed rather than granting extra lifetime. Heartbeat
   renewal keeps the holder epoch and carries a monotonic renewal revision plus transition id: the bridge accepts only
   the next live revision for the same lease, never an older deadline update or a renewal after its installed expiry.
   A pending renewal blocks control once the last confirmed expiry is reached; a lost ACK is reconciled, not client-extended.
3. **Explicit acquisition.** An operator needs a live session grant that covers the named shell and interactive control.
   An agent additionally needs an explicit, persisted delegation by that run's acting operator for this console. Delegation
   is not implied by starting a run or by owning a session grant; it cannot renew after that run ends. New grants do not
   silently replace the lease's selected `grantId`: release/reacquire records the new authorization.
4. **Takeover policy.** A currently authorized operator can take over an agent-held lease. Agent-to-operator or automatic
   agent reacquisition is refused while an operator controls the console. Operator-to-operator takeover is refused; the
   current operator releases, expires, or an authorized operator explicitly ends the console. An operator lease also binds
   a `controllerAttachmentId`: only that attachment may heartbeat/input/resize. A second tab of the same operator observes
   by default; moving control to it requires release/expiry and explicit reacquire, not a silent same-user takeover.
5. **Provider-side fencing.** PostgreSQL allocates a monotonically increasing `fenceEpoch` on each console control change.
   Under a per-console row lock/CAS, takeover atomically ends the old lease, creates a pending replacement, records an
   idempotent transition intent and audit entry, and stops admitting old-holder input. An authenticated internal
   `pty.fence` operation installs `(consoleId, epoch, leaseId or none, expiry, transitionId)` in the bridge's durable store.
   A per-console bridge executor serializes fence application with PTY writes; buffered input rechecks its epoch at write
   time. Duplicate identical transitions replay their disposition; older epochs or conflicting identities are refused.
   Only a bridge acknowledgement followed by DB finalization marks the replacement active and the takeover confirmed.
   Delayed acknowledgements cannot activate a superseded epoch. This is recoverable coordination, not a distributed DB
   transaction; the DB finalization/audit must be replayable after a crash.
6. **The guarantee has an explicit boundary.** After the bridge applies the new fence, no old-epoch input not already
   written to the PTY is accepted. Bytes already written and programs they started cannot be undone by taking over input.
   If acknowledgement is lost, UI shows `control pending/uncertain`, admits no new writer and reconciles the transition
   by id. The bridge independently expires the last installed lease; it never extends it during API/network failure.
   On bridge restart existing consoles remain input-disabled until provider state and a current DB epoch are reconciled;
   a lost shell is ended, never recreated and replayed as if it had survived.
7. **Every control mutation is authorized.** Input and resize require the active holder, lease id, epoch and current
   authorization; input also has the durable sequence/idempotency contract in the PTY proposal. Lease ids are references,
   not bearer credentials. Operator requests use the trusted session/CSRF boundary; delegated runtime requests use the
   run-scoped boundary from ADR-0099. Heartbeat/release cannot be used by a different actor/run to keep or end a lease.
   Output observation and attachment do not confer control; their access policy is specified separately in the proposal.
8. **End and revoke.** Reasons include `released`, `expired`, `detached`, `console_ended`, `grant_ended`, `emergency_stop`,
   `session_dead`, `run_ended`, `delegation_revoked`, `taken_over`. Release/expiry/detach leaves the shell alive but
   input-disabled; ending the console terminates the shell, not the implant. Grant revocation or run end stops admission
   immediately and installs a no-writer fence without waiting for TTL; emergency stop also requests shell termination.
   Record requested, provider-confirmed and uncertain outcomes separately. During a partition, do not claim immediate
   provider revocation or termination: reconcile it, while the last bridge lease still has a fixed maximum expiry.
9. **Durable transitions and audit.** Transition intent/state changes and their audit metadata commit together in DB;
   bridge stores fence application/disposition before acknowledgement. Expired rows are finalized under the same lock/CAS
   before acquiring a replacement. Audit includes actor, authorizing run where applicable, selected grant, old/new epoch,
   transition id, reason and timestamps; it contains no terminal bytes or credentials.

## Threat model

- **Assets/actors:** the owned shell, operator access and transcript; stale or compromised browsers, injected models,
  replayed requests and failed API/bridge processes.
- **Controls:** trusted holder identities, explicit agent delegation, live authorization, fixed bridge deadlines, monotonic
  epochs and serialization at the actual PTY write. DB uniqueness alone is not a provider enforcement boundary.
- **Residual risk:** at most the installed lease's remaining TTL during a partition; bytes admitted before fencing and
  target-side programs already running can continue. Control revocation is not proof of process cancellation or secret
  read permission. A confirmed takeover has the narrower write-boundary guarantee above.
- **Denial of service:** an authorized operator can retain control by renewing; another operator cannot seize its shell.
  Authorized explicit termination and expiry are recovery paths. Cap consoles/attachments and rate-limit control operations
  as specified in the proposal; agent takeover is available only to an operator with current interactive authorization.

## Consequences

- **Easier:** exactly one writer per shell, with a visible holder; a dead browser or run releases the console without manual
  action; agent yield is recorded, not implied.
- **Harder:** pending transitions need reconciliation across DB/bridge; heartbeat and revocation workers run independently
  of the browser. An agent treats takeover/refusal as a stop signal and cannot assume its previously started program stopped.
- **Given up:** two parties interleaving input in one shell. This is the point of the lease.
- **Migration:** console/lease/transition tables and constraints, bridge fence store and reconciliation worker; no inferred
  migration of existing single-shot commands into consoles. The proposal defines the input ledger and rollout order.

## Alternatives considered

- **No lease, last writer wins:** rejected because two writers interleave input in one shell and the shell state becomes
  unreadable from the transcript.
- **A lease without a timeout:** rejected because a closed browser would hold the console indefinitely.
- **Agent yields automatically whenever an operator is connected:** rejected because a connected but idle browser would
  stall the agent for the whole run.
- **Operator-only control, with agents limited to single-shot commands:** kept as the fallback if ADR-0095's lab gate shows
  that agent-held consoles cannot be made safe; this ADR does not depend on that outcome for operator control.

## Verification

Feature-flagged isolated implementation is permitted to produce evidence; production exposure waits for owner acceptance
and the proposal's native gates. Required cases:

- Two acquire/open requests and concurrent sweep/heartbeat yield one nonterminal console and one lease, with atomic audit.
- Expiry at -1/0/+1 ms, missed heartbeats, browser suspension and late heartbeat never create a grace period/resurrection.
- Delayed old input delivered after a takeover fence is refused; input already written is reported honestly, not undone.
- Crash after DB intent, after bridge application and before DB finalization; lost ACK and stale ACK reconcile one epoch.
- Bridge/API restart or partition never resurrects a lease; uncertain control does not admit another writer.
- Grant/run/delegation revoke and e-stop work without UI mounted; provider acknowledgement/uncertainty is explicit.
- Operator-to-operator takeover is refused; two tabs of one actor cannot duplicate/reorder writes.
- Out-of-order renewal ACKs, a heartbeat from an observer attachment, or a renewal delivered after bridge expiry cannot
  extend or resurrect the holder; no worker relies on a browser unload event to release control.
- Agent with the wrong run, operator, console or grant cannot heartbeat/acquire/input; read access does not grant control.
