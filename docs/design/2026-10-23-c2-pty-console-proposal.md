# C2 PTY console: implementation proposal

- **Status:** Proposed — 2026-10-23, revised after pre-implementation review. Isolated, feature-flagged implementation and
  native verification precede owner acceptance; production exposure waits for accepted ADRs and recorded native gates.
- **Decision owners:** ADR-0095 owns PTY/lifecycle/transcript decisions; ADR-0098 owns controller leases/fencing;
  ADR-0099 owns runtime admission, credentials, action authorization and command attribution. Their status stays Proposed
  until the owner accepts them. This proposal supplies the HTTP/bridge, storage, UI and verification contracts.

## Scope

- In: an explicit shell on an existing, owned C2 session; input/output, resize, Ctrl+C, attach/detach/reattach, end-console,
  one-controller leases, attributed input outcomes and retained transcript with current read permissions.
- Out: file transfer, production implant generation and WebShell. C2 HTTP transport does not make the connection a
  WebShell. These need separate registered providers/contracts and are not delivered by this PTY work.
- Operator PTY is independently deliverable. Agent-held PTY requires ADR-0099's admitted run and an explicit console
  delegation under ADR-0098. `c2_execute` remains single-shot; it is not an interactive-input tool.

## 1. Native mapping spike and source of truth

`infra/containers/sliver-bridge/Dockerfile` already pins Sliver **1.7.7**, verifies the binary SHA-256 and pins protobuf
commit **`0aa7e5bf962414823f12c3a8ea1f667f61b19ce2`**. It generates stubs during the image build. The existing
`infra/containers/c2-sliver.Dockerfile` installs an apt package without a Sliver package-version pin and is not the
reproducible source for this native gate. Keep the bridge's binary/protobuf versions aligned.

Verify the actual `Shell`/tunnel mapping against that pinned bridge: open/close semantics, output framing, PTY negotiation,
resize, exit detection and delivery of `0x03`. Do not assume a shell response alone creates a working terminal stream.
Record tested image/protobuf digests, actual RPC flow and unsupported platform behaviour. No production client depends
on a guessed RPC mapping. A Linux isolated target is the initial supported profile; other OS profiles remain unavailable
until they pass their own native gate. This is a time-bounded implementation spike, not an acceptance-before-code loop.

## 2. Authorization, ownership and control

- Operator auth remains the existing trusted cookie/session + CSRF boundary. Runtime auth is the narrow, admitted-run
  broker in ADR-0099, with explicit `c2.pty` audience/permissions and console delegation. Neither lease id nor a model-supplied
  actor/run id authorizes anything. Keep bridge bearer/mTLS credentials private to server infrastructure.
- On native run resume/continue, old PTY input is outcome recovery only, not newly authorized bytes. Preserve the original
  `inputId` and logical invocation mapping under ADR-0099's verified predecessor recovery contract. A new run requires a new
  explicit delegation/lease for genuinely new input; it cannot inherit or replay the old holder's input stream.
- Extend the real grant model with explicit permissions `execute`, `console_observe`, `console_control`; control includes
  observe. Existing grants migrate to `execute` only, not unrestricted shell authority. Opening/controlling a console needs
  an independently approved console-control grant covering the explicit shell path, plus live membership, open engagement,
  effective target scope/ROE window, stop state and any required action approval. Show these effective permissions in the UI.
- A shell path restriction does not restrict commands subsequently typed inside that shell. Console-control approval must
  explicitly describe that authority. Reuse existing policy/HITL checks for opening/delegating the shell; agent input must
  carry a trusted invocation/action-approval binding for its bytes/intended operation. If that cannot be evaluated under
  required policy, agent input is refused and the profile remains operator-only. Do not claim arbitrary keystroke content
  has the same semantic command validation as structured `c2_execute` path/argv.
- At most one nonterminal console per owned provider-session identity, enforced at DB and bridge. Agent/operator roles
  cannot evade an occupied lease by opening a second shell. A session may also expose independent single-shot commands;
  they retain their own live gates/ledger and never write into the PTY or masquerade as its transcript.
- Apply ADR-0098's pending-transition/fence protocol. An input/resize request passes Web authorization, then the bridge
  serializes its epoch/deadline check with the actual PTY write/control operation. Revocation stops new API admission;
  provider fencing/termination has its own acknowledgement/uncertain outcome. No claim of instantaneous remote stop
  during a partition; expiry/deny admission and reconcile as specified in ADR-0098.

### Read policy is independent from control

| Operation | Required authority |
|---|---|
| Console metadata / input disposition | Current membership/read permission, owned console, authorized metadata projection |
| Attach / live output | Current `console_observe` or control grant plus current sensitive-output read permission; no controller lease needed |
| Open / acquire / heartbeat / input / resize | Current console-control grant and applicable live gates; input/resize require active holder+epoch; acquire/heartbeat follow ADR-0098 |
| Detach | The actor's own attachment; cannot detach another observer or release another holder |
| Release / takeover | Holder release or authorized operator-to-agent takeover under ADR-0098; no operator-to-operator seizure |
| Terminate | Current console-control authority and reason; system e-stop/session cleanup uses a separate internal recovery authority |
| Retained transcript content/download | Current evidence classification/read permission; not conditional on an expired console grant becoming live again |

Live output is reauthorized per chunk/request, at least once per second on a long-lived subscription. Expiry, membership
removal or classification denial stops sending new live bytes and hides the live viewport; previously delivered bytes
cannot be revoked from the client. An expired grant may still allow the actor to read a finalized retained transcript if
the independent evidence read policy allows it. System-side collection continues as owned transcript capture, not as a
way for the expired actor to read the provider stream.

## 3. Typed bridge operations

All operations include protocol version, `engagementId`, owned provider `sessionId` and `consoleId` where applicable;
resolve the immutable session identity at the bridge. Unknown fields/operations and invalid base64 are refused. Control
operations have stable request/transition identities and stored dispositions; no side effect is retried under a new id.

| Operation | Input | Bound |
|---|---|---|
| `pty.open` | `requestId`, caller-reserved `consoleId`, explicit `shell`, initial dimensions | shell path ≤ 256 UTF-8 bytes, no implicit executable/argv; one nonterminal console per session |
| `pty.inspect` | console/open/control request identity | Read-only provider state/disposition; never recreate a lost shell |
| `pty.fence` | `transitionId`, `epoch`, `leaseId or null`, renewal revision, absolute expiry | Internal control only; durable idempotent epoch install/revoke/renew under ADR-0098 |
| `pty.input` | `inputId`, `leaseId`, `epoch`, `seq`, `dataB64`, authorization correlation | Decoded ≤ 4 KiB; exact next sequence for this epoch; stored disposition before any write |
| `pty.input.status` | `inputId`, `epoch`, `seq` | Read-only: not seen/reserved/written/refused/uncertain; no input bytes in general metadata |
| `pty.output` | collector identity, `cursor`, `limit` | `limit` 1–64 KiB; byte offsets, next cursor and explicit gap intervals |
| `pty.resize` | `requestId`, holder lease/epoch, `cols`, `rows` | Integer dimensions 1–500 each; serialized under current fence |
| `pty.attach`, `pty.detach` | actor-owned `attachmentId` | Attachment only, no grant/control acquisition; detach cannot end the implant |
| `pty.terminate` | `requestId`, reason | Idempotent shell termination, not implant termination; state is not ended until observed |

Ctrl+C uses byte `0x03` through the same input ledger, with lease/sequence/policy checks. Its write acknowledgement does
not prove a remote program exited; output/provider state supplies that observation. Bound shell encoding support in the
native profile and stream bytes as base64/byte frames; UTF-8 decoding must handle chunk boundaries without changing offsets.

### Concurrency, sequence and unknown outcomes

1. `inputId` is generated by the authenticated client/tool adapter before submission, not by the model. Under a console
   lock/CAS, Web reserves `(consoleId, epoch, seq)` and payload hash, actor/admission/grant/action-approval refs and audit
   metadata. `seq` starts at 1 for a new epoch; it is never reused within that epoch. Only one unsettled input per console
   is admitted. Validate/authenticate before reservation; body-shape/authority refusals do not allocate a sequence.
2. Bridge persists the identity/hash/disposition under the per-console executor before writing bytes. A duplicate exact
   identity returns its stored disposition without another PTY write; changed bytes/actor/context or sequence conflicts
   return 409. Old epochs are refused even when their requests arrive after takeover. A write acknowledgement means bytes
   were accepted by the PTY transport, not that the shell command completed successfully.
3. Lost response causes status reconciliation only. A bridge crash between persistence and write/ack can be irrecoverably
   uncertain; neither side infers success/failure from transcript text. API `reserved` + bridge `not_seen` is not permission
   to resend: the original request may still arrive. Block later input, record uncertainty and install a no-writer fence.
4. A terminal, proven disposition advances the acknowledged sequence; a stale-epoch refusal cannot affect a newer epoch.
   If the current epoch loses admission after reservation, fence/end that epoch before further input rather than skip a
   sequence. Reconcile delayed original requests against their stored identity. An unresolved/partially written input
   freezes the console even after takeover; an epoch change never makes uncertain bytes safe to replay.
5. Recovery of an irrecoverable unknown requires explicit terminate and provider-confirmed shell exit before a new console
   can open. If exit cannot be proven, keep the console/session slot uncertain and show the reason. Opening a shell with
   a lost ACK is reconciled using the same reserved console/open identity; never launch a replacement speculatively.

### Rate, buffering and resource bounds

- Input token bucket: 8 KiB/second, 16 KiB burst per console; 4 KiB/frame. Return 429 with retry-after **before** reserving
  an input when the bucket/one-in-flight capacity is exhausted. Retrying a refused frame is not replaying accepted input.
- Provider output: 1 MiB/second sustained, 1 MiB burst; collector memory queue ≤ 1 MiB per console and Web read ≤ 64 KiB.
  Prefer native transport backpressure if verified by the spike. If it cannot bound memory/production without losing
  control, fence and terminate with `output_limit`; record any missing byte interval, not fabricated terminal content.
- Maximum 8 observers/attachments per console; attachment/lease heartbeats 15 seconds, dead-attachment expiry 45 seconds.
  Apply authenticated actor/engagement rate limits to opens, lease transitions, resizes and output reads too; choose lower
  deployment resource limits when capacity requires it, never silently raise the protocol bounds.
- Transcript stores at most 100 MiB of raw output **plus bounded structured input/control/gap records within the same total
  cap**. Reserve marker metadata before the boundary. At cap, stop retaining content but continue bounded live output;
  maintain absolute offsets/gap ranges and show `recording capped`, not a complete transcript claim. Do not rotate into
  unlimited hidden files. Native tests may lower the cap through test configuration; production upper bound stays 100 MiB.

## 4. Web API and storage contract

Under the existing C2 routes, one resource per console and one lease resource (ADR-0098):

- `POST /api/engagements/:id/c2/consoles` — stable open request id, session, explicit shell and dimensions.
- `GET /api/engagements/:id/c2/consoles` and `GET .../:consoleId` — owned metadata, control/attachment state and pending operations.
- `POST /api/engagements/:id/c2/consoles/:consoleId/input` — stable input identity, lease id, epoch, sequence and bounded bytes.
- `GET .../:consoleId/inputs/:inputId` — read-only disposition/reconciliation, never re-dispatch.
- `GET /api/engagements/:id/c2/consoles/:consoleId/output?cursor=` — paged output; a request with a stale cursor receives a
  gap marker, never silently missing bytes.
- `POST .../attach`, `POST .../resize`, `POST .../detach`, `POST .../terminate` — identities and preconditions above.
- `POST /api/engagements/:id/c2/consoles/:consoleId/lease` (acquire), `.../lease/heartbeat`, `.../lease/release`,
  `.../lease/takeover`.

Auth branches are per §2, not a blanket grant check on all reads. All foreign resource identities return uniform not-found;
unknown epoch/identity, occupied control and stale sequence return conflict with safe reason codes. An unknown outcome is
202/pending with its stable identity, not a false 200 success. Invalid payload is 400, authenticated policy refusal 403,
rate refusal 429 and unverifiable dependencies 503. DTO validators, response/body limits and source availability are shared
contracts. Terminal content uses dedicated authenticated byte/content endpoints and no-store; metadata DTOs, logs, notices
and general SSE do not contain terminal bytes. This clarifies ADR-0095's transcript confidentiality rule for the live UI.

| Owner / resource | Required persisted information |
|---|---|
| Web `C2Console` | Owned provider session/asset identity, shell, open request/fingerprint, createdBy, originating admission/run when applicable, `opening/open/ending/ended/uncertain`, `fenceEpoch`, pending transition id, transcript reference, terminal reason/timestamps |
| Web lease/transition | ADR-0098's `ControllerLease`, current/pending epoch, transition intent, acknowledgement/finalization and immutable audit |
| Web `C2ConsoleInput` | Console/epoch/seq/inputId uniqueness, immutable payload hash, actual actor/operator/run/invocation/grant/action-approval refs, byte length, reserved/written/refused/uncertain disposition, timestamps and safe reason; terminal bytes remain in classified artifact storage |
| Web attachment | Actor-bound attachment identity, created/lastSeen/ended timestamps; operator lease binds one controller attachment, other tabs observe |
| Bridge durable store | Console→native shell/tunnel identity, open/control/input dispositions, highest applied fence, epoch seq high-water, fixed expiry, absolute output cursor/gaps and bounded spool metadata |
| Retained artifact | Console provenance, immutable finalized segments/digests + bounded manifest, byte/control gaps, classification, size/cap status, retention deadline and authorized content references |

Transcript starts as **sensitive** (passwords/input may occur). Live readers need both session-observe and sensitive-content
permission; retained access/classification uses the existing evidence authority. The capture worker owns writing/finalizing
segments, not the browser. Mutable append state is not labelled an immutable capture with a constantly changing digest;
finalize immutable segments and their manifest, retain source/offsets and seal the final manifest on termination. Input
disposition metadata can be audited without copying raw input into the audit DB. At most one authoritative collector drains
a console stream; observers read that stream/spool rather than competing to consume provider bytes.

Default retention is 30 days from console end; while open, size cap still applies. An actual server-owned retention worker
checks legal hold and referenced-evidence policy, deletes permitted bytes/segments and preserves a tombstone/audit record.
If legal hold/reference prevents deletion, mark deferred cleanup with its reason; expiry never fabricates a successful delete
or erases unrelated C2 commands. Retention worker and collector recovery must be implemented before claiming these policies.

## 5. Console UI and failure behaviour

The existing Console tab gains the interactive panel when the supported profile and actor's explicit console permissions
allow it. Add to the current session workspace rather than redesigning AI Workspace or introducing another fixed column.
The panel shows, in words, the state of the console and the controller:

- Connection state, shell lifecycle, **this observer's** attached/detached state, access and controller are separate labels.
  Show opening/attaching, attached, control pending, uncertain input/termination, ended reason and expired access.
- A takeover control for agent-held leases states that queued old input is refused once the bridge fence is confirmed;
  already written bytes/programs are not cancelled by takeover. While fencing is pending neither party gets new admission.
- The shell executable is shown on the panel. The console never presents a shell without naming it.
- A marker wherever output has a gap or the transcript cap was reached.

Keyboard handling includes terminal key sequences, IME, paste boundaries and Ctrl+C through the input ledger. Never show
typed local echo as a provider result; coalesce keystrokes within frame/rate bounds. Resize is controller-authorized and
debounced; observers resize their viewport locally without mutating the remote PTY. Sanitize terminal escape handling:
disable remote clipboard control, arbitrary URL/file opens and other privileged terminal integration by default.

| Situation | Behaviour |
|---|---|
| Lost open/input ACK | Inspect same identity; no new open or resend of bytes. Unknown input freezes further input; inspect/fence/explicit termination follows §3. |
| Output cursor before retained window | Return gap interval and next byte cursor; absolute offsets never reset. Unknown console/foreign cursor domain is refused, not silently rebound. |
| Implant/tunnel dies | End shell only when provider exit is observed; otherwise uncertain. Session connection state uses its actual provider observation. |
| Grant expires/revoked | Stop input admission and new live output; no-writer fence. Retained transcript may remain readable under current evidence permission. Shell connection is not falsely marked dead. |
| Browser closed/network lost | Best-effort detach; dead attachment detected by heartbeat timeout without unload event. Other observers remain attached. Holder's lease expires; reattach does not automatically reacquire control. |
| Release or control TTL expiry | Shell may continue input-disabled. Running target-side programs need explicit interrupt/terminate, not a UI assumption. |
| Emergency stop | Stop admission, revoke control and request termination; show requested/confirmed/uncertain, not instant remote success. |
| API/bridge restart or partition | Keep identities/fences; deny new control until reconciled. Lost native shell is not recreated; unfinished input remains uncertain. |
| Transcript cap/output-rate bound | Show recording-capped/gap or output-limit termination as specified; output memory/retention remains bounded. |
| Single-shot command fails while console is open | Single-shot ledger outcome remains separate; do not change PTY lifecycle or replay console input. |

## 6. Verification and acceptance gates

| Gate | Required proof |
|---|---|
| G0 Mapping | Rebuild pinned bridge, record exact RPC/tunnel semantics, explicit shell, resize/Ctrl+C/exit on the supported OS profile |
| G1 Authority | Cookie/CSRF vs run-token branches, new permission migration, wrong actor/run/console, scope/grant/action policy and classification; no raw secrets/terminal bytes in public metadata/logs |
| G2 Lease/fence | Every ADR-0098 case, including delayed input after confirmed takeover and crash between DB intent/bridge ACK/DB finalize |
| G3 Input/unknown | Duplicate identity executes once; changed input conflicts; out-of-order/stale seq/epoch refused; lost ACK/partial write/crash freezes later input and never resends, including native run resume under a new admission; uncertain open does not create a second shell |
| G4 Output/evidence | Independent authorized observers, single collector, monotonic cursor and gap ranges, UTF-8 boundaries, byte-exact finalized segments/digests; grant-expired fresh reads vs retained reads; cap/rate/slow-reader/retention/hold behaviour |
| G5 UI/layout | Server-driven states, permission/read-only mode, pending/uncertain control, keyboard/IME/paste/resize, reload/reattach, active agent controls and no hidden data echo/clipboard privilege |
| G6 Native | Isolated target with real implant: shell state (`cd`/environment), Ctrl+C, resize, detach/reload/reattach, agent-to-operator takeover, run/grant revoke, terminate vs implant survival, restart/recovery and cap behaviour |

Use targeted unit/server/UI tests for G1–G5 and native gate G6 outside ordinary CI; fixtures certify UI states only. Include
concurrency, missed events and no-browser cases, not merely successful dispatch. Store date, source/image/protobuf digest,
configuration/timing/bounds, actual operator/admission/run/console/lease/input ids and sanitized outcomes under
`tests/local/artifacts/c2-pty/<run-id>/`. Keep native credentials and transcript secrets out of published evidence. A lowered
test cap/rate must be recorded alongside proof of the production upper-bound checks.

## 7. Order of work and release

1. G0 isolated spike against the pinned bridge; record results and any platform limitations. Proposed status allows this work.
2. Freeze shared DTOs, reason codes, auth/permission migration and schemas; add migrations/constraints, input/transition
   ledgers and targeted failure tests. Keep each PR within the repo's one-concern budget.
3. Implement operator-only console behind a server capability flag **off by default**, bridge fencing/input/output plus
   DB reconciliation/collector/retention workers, then UI. Rollout flag is exposure, never authorization.
4. Independently implement ADR-0099 admission/auth/tool/idempotency/policy cutover. Add agent-console delegation and
   `c2.pty` control only when that broker and policy binding are verified. Operator native tests do not depend on this step;
   agent-held native tests do.
5. Run G1–G6; record failures as blocked/unverified, fix and rerun affected cases. Operator-only gates can pass separately;
   agent-required cases remain blocked until delegation/policy proofs pass. No target lab is used for harness debugging.
6. Owner reviews native evidence and accepts applicable ADRs; only then enable the supported production profile. Do not
   claim owner acceptance or mark ADR-0095 Accepted merely because a stub/UI test passes.
7. Upgrade/cutover with active consoles quiescent. Disable exposure on rollback, stop new admission, fence/reconcile current
   leases and explicitly terminate/detach per operator intent; preserve DB/bridge ledgers and transcripts. Do not restore the
   privileged Bash client path or delete volumes to recover an unknown outcome.

## 8. Remaining evidence, not unresolved authority decisions

- Native RPC/tunnel and platform behaviour from G0/G6.
- Measured latency, heartbeat throttling/clock safety and effective resource bounds under the native load profile.
- Actual production build/configuration and retained/streamed-byte privacy results.

Lease ownership/takeover, credential issuance/expiry, access-after-expiry, seq recovery and release ordering are specified
above or in ADR-0098/0099. Deviations discovered during the spike update the Proposed documents with rationale before
production implementation relies on them; no hidden fallback changes those contracts.
