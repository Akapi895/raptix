# ADR-0099: Dispatch agent C2 commands through the web command ledger so each command names its run

- **Status:** Proposed — 2026-10-23. Direction confirmed by the operator on 2026-10-23; the record stays Proposed until the
  repository owner accepts it in writing.
- **Date:** 2026-10-23
- **Deciders:** repository owner (pending)
- **Related:** ADR-0036 (typed Sliver bridge; the command ledger), ADR-0095 (interactive console), ADR-0098 (controller lease),
  `packages/raptix-skills/raptix_skills/defs/standard/post-exploit/c2-sliver/SKILL.md`, `CONTRIBUTING_AGENT.md`
  (guard-rail changes need a threat model)

## Context

Agents drive Sliver through the sandbox `bash` tool: the `c2-sliver` skill starts `sliver-client console` in a tmux session
and sends commands to it. Those commands never reach the web server. The command ledger therefore holds only commands an
operator dispatched from the console, and a session created or used by an agent has no record of the run that did it.

The web dispatch route `POST /api/engagements/:id/c2/sessions/:sessionId/commands` already authorizes by the operator's
identity and an approved, unexpired grant, and records each command with its status and output. The `C2Command` row has
no run column. The runtime process joins `raptix-net`, which reaches the web API; the sandbox joins `sandbox-net`, and the
web API joins `raptix-net` only. Runs are identified by their runtime run id, which the web console already reads.

## Decision

1. **Typed execution.** `c2_execute` accepts only owned session identity, an explicit executable path and bounded argv.
   Deployment, engagement, thread, authorizing native run, acting operator and invocation identity come from trusted runtime
   admission/context, never from model arguments. Runtime tools use the Web HTTP boundary; shared contracts belong in
   Core/SDK or the owning HTTP contract, without importing Web/Prisma into Python. An unconfigured Web dispatch capability
   is unavailable; it never falls back to `bash` or direct Sliver RPC.
2. **Trusted admission precedes token issuance.** The Web run-admission path persists `admissionId`, deployment/environment,
   engagement, thread, assistant, request id and `actingOperatorId` before asking LangGraph to start. `actingOperatorId` is
   the authenticated actor submitting that run, including a new resume/continue run; it is not the thread creator or a
   caller-supplied actor. The admission id is correlation metadata, not a secret. A runtime startup hook exchanges the
   native run id + admission id using a deployment/environment-scoped mTLS workload identity. Web verifies the caller's
   environment, the exact owned runtime endpoint and native run metadata, then waits until the existing ownership ledger
   binds that run. A run may start before its HTTP ACK is recorded, so the hook waits at most 10 seconds and fails closed
   for C2 when binding is not confirmed; it never mints authority for an uncertain/unbound launch. Reconciliation may
   confirm the binding and a later tool invocation may repeat this non-dispatch exchange. Create-run ACK does not wait for
   the hook; no token is needed in the create-run payload. Planning runs do not receive C2 dispatch authority.
3. **Ephemeral run credentials.** Web mints cryptographically random opaque tokens, stores only their hashes and the
   admission binding, and returns plaintext only to the authenticated runtime process over TLS/mTLS. TTL is 60 seconds;
   renewal is attempted after 20 seconds and rechecks the admitted native run, active actor/membership, open engagement
   and stop state. Every dispatch also verifies those live conditions and the selected session grant. Known terminal,
   interrupted, paused or cancel-requested runs cannot dispatch or renew; unobservable run state fails closed. Expiry is
   bounded even if completion events are lost; terminal observation/revocation invalidates tokens independently of the UI.
   Rotation revokes the prior token; a lost renewal response is recovered through the workload-authenticated exchange,
   never by extending a token on the client. Logout ends browser access, not an already admitted run by itself; account
   disable, membership removal, run cancellation or explicit delegation revocation stops delegated dispatch.
4. **Secret isolation and workload scope.** Tokens live only in a runtime credential store keyed by the trusted admission
   and run; subagents access a broker through explicit run context. Tokens, workload private keys and renewal responses
   never enter prompts, model-visible arguments, graph state/checkpoints, metadata, SSE, logs or sandbox files/env. A
   workload certificate only authenticates the configured runtime environment to exchange/inspect its admitted runs;
   it is not a general operator session or dispatch credential. Environment teardown revokes it. The ordinary dispatch
   endpoint accepts either cookie/CSRF operator auth or the narrow run-token auth, never a caller's actor/run-id override.
   Do not make the route public or grant arbitrary routes a blanket service-auth bypass.
5. **Grant and action authorization remain separate.** The acting operator's exact approved grant is selected for the
   session/path/action and recorded as `grantId`; its expiry/revocation applies before reservation, immediately before
   provider invocation and at completion. Current scope/ROE window, session-target ownership, e-stop and engagement-open
   checks remain in the shared C2 service. Selection cannot silently switch to another grant mid-command. `c2_execute`
   participates in RoE/EngagementContext and HITL/action policy evaluation with normalized path/argv and objective context.
   Existing rules matching `^bash$` or the `command` argument do not automatically protect this tool: add explicit
   dangerous-action coverage and refusal tests, including when optional conversation HITL is off. Missing policy context
   for a policy-required action is a refusal; a session grant never substitutes for action approval. Bind approved input
   to its payload hash; changed arguments need a new approval.
6. **Stable identity, attribution and refusals.** Add nullable `runId`, `threadId`, `invocationId`, `actingOperatorId`,
   `grantId` and `admissionId` plus `origin` (`operator`, `agent`, `legacy_unknown`) to the command/attempt model as
   appropriate. Agent `runId` is the native Web-admitted run authorizing dispatch; a child agent invocation additionally
   names its dispatch/instance, rather than inventing a new Web run. If a genuinely separate native child run is introduced,
   it requires its own verified admission chain before using this boundary. Operator commands have no dispatching run;
   legacy rows are `legacy_unknown`, not inferred operator actions. Index `(engagementId, runId)` and validate all ownership
   references against the admitted thread/run; never infer origin from null `runId` alone.
   `requestId` is assigned to a durable logical invocation before dispatch, as specified below; it is not regenerated
   merely because LangGraph resumes under a new admission/native run.
   Its immutable fingerprint includes origin, actor, run/admission, session, executable and argv. Keep the existing unique
   `(engagementId, requestId)` key; same identity/same payload replays its record, changed payload or another actor/run
   conflicts. No client retry invents another request id for an uncertain invocation.
7. **Accepted work and refused attempts are different records.** After authentication/owned-run validation, keep a durable
   `C2DispatchAttempt` for idempotency, attribution and policy refusal. Before any provider call, atomically reserve/link
   the command row/session slot and the allowed attempt; if that transaction/audit fails, do not dispatch. A request refused
   before execution records a reason code and disposition on the attempt without claiming a command ran or retaining a
   session lock. Malformed/unauthenticated requests use bounded security audit only, without forged run attribution or raw
   secret arguments. Provider outcomes continue to be persisted even if completion authorization is lost. Attempt/command
   inspection never invokes work, and unavailable audit storage cannot be converted into a success.
8. **Narrow recovery authority.** Run tokens have audience `c2.dispatch` and permissions limited to dispatch and inspection
   of attempts/commands belonging to the same admission. They do not authorize grants, listeners, profiles or general
   history. Inspection/reconciliation checks current actor data-access/classification and cannot dispatch, even after
   grant expiry. After token/run expiry a workload-authenticated recovery endpoint may inspect only known records of that
   verified admission, with the same current read policy; it cannot renew terminal runs, create new work or read another
   actor/run's records except the explicit, read-only predecessor recovery link below. Return bounded retained
   output/refusal/uncertain status. Irrecoverable unknown outcomes remain
   unknown and keep ADR-0036's dispatch lock; never silently rerun the tool from a checkpoint replay.
9. **Interactive delegation is explicit.** ADR-0098 may use the same admission broker with separate `c2.pty` permissions
   bound to an operator-created console delegation. `c2_execute` itself does not open/write a PTY or acquire a controller
   lease. Operator takeover ends delegated PTY authority; single-shot access is not a way to write into that PTY. The PTY
   proposal defines its own input ledger and native acceptance.
10. **Close the old privileged path at rollout.** For managed Web engagements, the selected sandbox/profile does not receive
    native Sliver operator configs, bridge credentials or runtime workload keys and cannot reach the native operator gRPC
    control endpoint. Remove standard skill instructions that use the privileged client, including indirect tmux/session
    examples. The binary may remain only as an inert/offline dependency where needed; binary removal alone is not enforcement.
    Existing live client consoles must be quiesced and credentials/mounts/network access reconciled before enabling the new
    path. Rollback disables new agent C2 exposure and requires explicit operator action; it does not restore an implicit
    Bash fallback. Other deployment profiles with unmanaged direct C2 cannot claim complete Web-ledger coverage; display
    that limitation and migrate them explicitly, rather than guessing attribution from logs.

### Logical invocation identity across checkpoint resumes

A native run/admission is an authorization episode, not the identity of a logical tool invocation. Resume/continue may
create a new run after a command executed but before its result was checkpointed. Preserve the original command identity:

- Before first dispatch, Web records a unique `C2Invocation` key from trusted deployment/engagement/thread, producing
  message/tool-call identity and agent instance/dispatch identity. It links the original admission, immutable command
  payload hash, `requestId` and attempt/command disposition. Use native persisted message/tool-call identities, not a model
  argument, browser-generated substitute or the current native run id as the replay key. First submission atomically
  claims that key; concurrent continuations cannot create another attempt for it.
- A new resume/continue admission records its verified predecessor/recovery chain in the same owned thread. The server
  authorizes that relationship from runtime/ownership records, never from a caller-provided arbitrary predecessor id.
  The runtime broker checks outstanding persisted tool calls before permitting C2 execution under the new admission.
- Re-observing an existing logical invocation under a linked continuation is **recovery only**: inspect the original
  attempt/command under current data-read permission and the matching payload hash. Return its retained result, refused
  or uncertain state without a provider execute. The original acting actor/run/grant attribution never changes, and the
  new admission receives no authority to dispatch using the predecessor's expired credential or grant.
- This is a narrow exception for an explicit predecessor record, not general cross-run replay access. An unrelated run,
  changed payload or unverified ancestry is refused. A continuation actor without current read permission sees refusal,
  not the original output. `c2.dispatch` cannot write another run's command even when predecessor read recovery is allowed.
- If stable invocation identity, predecessor relationship or original outcome cannot be established after a restart,
  fail closed with `requires_operator_reconciliation`; missing ledger data alone never proves an old call did not execute.
  Do not derive a fresh request id to make the resumed tool call succeed. Explicitly requested new work gets a new native
  logical tool-call identity, current-admission authorization and a distinct attempt; it is not automatic recovery.

### HTTP credential and recovery boundary

The existing dispatch endpoint remains the only single-shot execution route. Add narrow internal endpoints, registered
only on the runtime-authenticated boundary:

| Endpoint | Authentication and behaviour |
|---|---|
| `POST /internal/c2/run-credentials/exchange` | mTLS workload identity + `{admissionId, nativeRunId}`; validates the recorded admission and returns a short-lived token/audience/expiry or pending binding. No caller actor/grant override |
| `POST /internal/c2/run-credentials/renew` | Same workload + admitted run and current credential generation; rotates atomically, returns only the new token/expiry. A late generation conflicts; re-exchange serializes recovery of lost rotation ACK |
| `GET /internal/c2/admissions/:admissionId/attempts/:requestId` | Workload-scoped outcome inspection/reconciliation; own-admission or verified predecessor recovery only under Decision 8 and the logical invocation contract; current read policy, no dispatch |
| `GET /api/engagements/:id/c2/attempts/:requestId` | Browser cookie/read policy or the same-admission run token; inspect known attempt/command, no new work and no general history authority |

Use an actual mTLS listener or a trusted local TLS-termination boundary that strips incoming identity headers and binds
the verified certificate to the request. A public forwarded certificate/actor header is not workload authentication.
Deployment provisioning registers the runtime environment's certificate identity with the Web verifier, distributes the
private key only to the runtime service and rotates/revokes it at environment lifecycle boundaries. A shared API key is
not an alternative when mTLS is unconfigured: report C2 delegation unavailable. Operator UI dispatch keeps its existing
cookie/CSRF policy; a browser cannot call internal exchange/renew endpoints using that session.

Credential generations are serialized per admission/audience, with at most one current generation; concurrent subagents
share the runtime broker's renewal, not competing tokens. Dispatch uses the immutable recorded attempt as its identity;
authorization failure due to token rotation triggers only credential recovery/status inspection, not a new command id.
Store raw secret bytes nowhere in durable request bodies; capture workload-auth failures in bounded redacted security audit.

## Threat model

- **Assets/actors:** owned target sessions, acting-operator grants, credentials, execution and retained outcomes; injected
  models, compromised sandboxes, stolen tokens, a wrong runtime environment and replayed/late callbacks.
- **Controls:** verified run admission, environment-bound workload identity, memory-only short-lived credentials, immutable
  actor/grant attribution, existing scope/action/HITL enforcement and durable idempotency before provider invocation.
- **Residual risk:** theft from a compromised runtime process can exercise that token's authority until revoked/expired,
  subject to current gates. A compromised workload identity can request credentials for that environment's admitted runs;
  isolate runtime keys and the process, revoke at teardown, and do not claim protection against a fully compromised issuer.
  Commands already executed are not undone when authority is revoked; truthful outcomes remain readable under read policy.
- **Guard-rail change:** tool replacement, policy mappings, skill instructions, credential bootstrap and control-network
  boundaries all belong in the implementation PR's threat model. Preserve shadow/recovery tools and established safety
  invariants; safety overrides require the repo's explicit ADR/override process, not merely this feature flag.

## Consequences

- **Easier:** each session and each command is traceable to a run; output is retained in the ledger; grant checks happen in
  one place for every command.
- **Harder:** runtime startup/auth broker and Web admission must coordinate without a run-id bootstrap race; recovery must
  survive API/runtime restart without persisting raw credentials. C2 is unavailable when these dependencies cannot verify authority.
- **Given up:** free-form use of the `sliver-client` console by agents. Interactive use moves to the controller lease
  (ADR-0098) and the interactive console (ADR-0095).
- **Migration:** command attribution/origin columns and index; admission/recovery-chain, logical invocation, hashed credential
  and attempt records with owned references; auth boundary/broker, runtime tool/policies, skill/network/mount changes. Backfill only `legacy_unknown` for
  existing rows; do not invent run or actor ownership. UI/contracts project attempts, origin and producing run separately.

## Alternatives considered

- **Keep agents on `sliver-client` and reconcile logs afterwards:** rejected because log reconciliation cannot reliably link
  a command to its run, and the output would not be in the ledger.
- **Give the runtime a shared service secret:** rejected because a shared secret cannot be scoped to one run or revoked when
  the run ends.
- **Write agent activity back into the graph store:** rejected because it records claims about commands, not an authorized
  dispatch that the grant gates.

## Implementation boundaries

Mint/rotation, managed-profile cutover and legacy attribution are decisions above, not deferred design questions. Proposed
status permits isolated, feature-flagged verification code; owner acceptance and recorded native evidence precede production
rollout. Operator-only PTY can be verified independently of this runtime tool, using ADR-0098; agent-held PTY additionally
requires the admission/delegation contracts here. The shared bridge credential used by the Web service is a different private
boundary from a per-run credential and is never distributed to agents/sandboxes.

## Verification

Required before acceptance:

- Actual runtime tool dispatch appears with the correct actor/admission/thread/native run/invocation and retained outcome.
- Delayed native run ACK, uncertain launch, restart and lost renewal ACK never mint credentials for an unbound/wrong run.
- Wrong deployment/environment/run/engagement, forged actor fields, terminal/paused/cancelled run, disabled actor and removed
  membership are refused. Resume creates a new verified admission; it cannot inherit the prior run's token/operator by accident.
- TTL -1/0/+1 ms, renewal failure and missed terminal events bound credential lifetime; redaction tests inspect prompts,
  graph snapshots, metadata, stream events and sandbox files/env for secret absence.
- Parallel subagent renewal, lost rotation response and forged forwarded-certificate headers do not create multiple current
  credentials, an auth bypass, a new command identity or cross-admission outcome access.
- Expired/revoked grant or scope/stop/action-policy refusal creates an attributed refused attempt without provider execute.
  Mandatory dangerous-action HITL remains required when optional thread HITL is off.
- Retry same invocation executes once; another run/actor or changed args with the same request id conflicts. Lost response,
  checkpoint replay and completion authorization failure preserve actual/uncertain outcome without duplicate execution.
- Crash after provider execution but before tool-result checkpoint, then native resume/continue with a new run/admission:
  verified predecessor recovery returns the original record without execute or reattribution. Unrelated ancestry, changed
  payload, missing logical identity or lost ledger produces refusal/operator reconciliation, never a new dispatch id.
- Recovery after grant/token/run expiry observes only the admission's known outcomes under current read access, never starts work.
- Managed sandbox cannot use native operator configs/control endpoints, even by invoking the binary through Python/Bash.
  Old active consoles are reconciled; missing Web capability has no privileged fallback; legacy origin remains unknown.
