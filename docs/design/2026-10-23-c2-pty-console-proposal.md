# C2 PTY console: implementation proposal

- **Status:** Proposed — 2026-10-23. Implementation waits for ADR-0095, ADR-0098 and ADR-0099 to be accepted, and for the
  native lab gate in ADR-0095 to pass.
- **Owner decisions this builds on:** ADR-0095 (PTY, one controller, detach and reattach, transcript as artifact) and
  ADR-0098 (controller lease). This document does not restate those decisions. It proposes how they land in the bridge, the
  web API and the console.

## Scope

- In: an interactive shell on an existing C2 session, opened with an explicit shell executable; input, output, resize,
  Ctrl+C, detach, reattach and end-console.
- Out: file transfer (no file adapter exists); WebShell (no provider is registered); agent-driven PTY beyond what ADR-0098
  allows.

## Open question that blocks implementation

The bridge would map `pty.*` onto Sliver's `Shell` RPC. The repository does not pin the Sliver protobuf definitions, so the
stream semantics are unverified: how output is framed, what a closed shell returns, and whether Ctrl+C arrives as a
control byte on the input stream. Verifying these against the Sliver version pinned in
`infra/containers/c2-sliver.Dockerfile` is the first implementation step. Until then the mapping is a hypothesis, and no
client code depends on it.

## Bridge operations

All typed, all bounded, all checked against the owned engagement and session before any call to Sliver:

| Operation | Input | Bound |
|---|---|---|
| `pty.open` | `engagementId`, `sessionId`, `shell` (explicit executable path) | shell path ≤ 256 bytes; one open console per session per controller |
| `pty.input` | `consoleId`, `leaseId`, `seq`, `dataB64` | decoded ≤ 4 KiB; `seq` must be the next expected |
| `pty.output` | `consoleId`, `cursor`, `limit` | `limit` ≤ 64 KiB; returns the next cursor and any gap marker |
| `pty.resize` | `consoleId`, `cols`, `rows` | 1–500 each |
| `pty.detach` | `consoleId` | none; the implant session stays alive |
| `pty.terminate` | `consoleId` | none; ends the shell process, not the implant session |

Ctrl+C is not a separate operation. The console sends byte `0x03` through `pty.input`, so the lease and sequence checks apply
to it as they do to any input.

## Web API

Under the existing C2 routes, one resource per console and one lease resource (ADR-0098):

- `POST /api/engagements/:id/c2/consoles` — open, with the explicit shell.
- `POST /api/engagements/:id/c2/consoles/:consoleId/input` — input with lease id and sequence.
- `GET /api/engagements/:id/c2/consoles/:consoleId/output?cursor=` — paged output; a request with a stale cursor receives a
  gap marker, never silently missing bytes.
- `POST .../resize`, `POST .../detach`, `POST .../terminate`.
- `POST /api/engagements/:id/c2/consoles/:consoleId/lease` (acquire), `.../lease/heartbeat`, `.../lease/release`,
  `.../lease/takeover`.

Every route authorizes the actor and the grant before the bridge call, and every refusal carries the server's reason.

## Storage

- `C2Console`: `id`, `engagementId`, `sessionId`, `shell`, `state` (`open`, `detached`, `ended`), `createdAt`, `endedAt`,
  `endReason`.
- Transcript: one retained artifact per console, capped at 100 MiB, retained 30 days, with an explicit truncation marker
  when the cap is reached. Transcript content never enters logs or public DTOs, and its access follows the evidence masking
  rules.
- Lease: `ControllerLease` from ADR-0098.

## Console UI

The Console tab of a session (the workspace added in this branch) gains an interactive panel when the actor holds an
interactive grant. The panel shows, in words, the state of the console and the controller:

- `attaching`, `attached` (controller: you, agent, or none), `detached` (reattach available), `ended` (with the reason),
  and `expired access` (the connection is still alive; input is refused).
- A takeover control when an agent holds the lease, with a confirmation that says the agent's next input will be refused.
- The shell executable is shown on the panel. The console never presents a shell without naming it.
- A marker wherever output has a gap or the transcript cap was reached.

Keyboard handling: printable keys and Enter are sent as input; Ctrl+C is sent as `0x03`; resize follows the panel size.

## Failure modes and what the UI shows

| Situation | Behaviour |
|---|---|
| Input outcome uncertain (network lost after send) | Never resent. The panel shows the input as uncertain and offers reconciliation from the server's record. |
| Output cursor behind the window | Gap marker in the transcript; the console keeps going from the current cursor. |
| Implant dies | Console ends with `session_dead`; the connection state says dead. |
| Grant expires during a session | Input refused with the server's reason; output stays readable; access reads "Expired". |
| Browser closed | Console detaches; reattach works while the implant lives. The lease expires after 45 seconds without heartbeat. |
| Emergency stop | Lease ends with `emergency_stop`; console ends. |

## Tests and gates

- Unit: lease transitions as a pure state machine; sequence and cursor arithmetic; the bounds in the table above.
- Server: concurrency of two acquires; takeover refusing the agent's next input; grant revocation ending the lease with the
  session still connected; a stale sequence refused.
- UI: states rendered from fixtures. Fixtures do not satisfy the gate below.
- **Native lab gate (ADR-0095, required for acceptance):** an isolated target container with a real implant session. The
  gate covers opening a shell, `cd` and environment persisting across inputs, Ctrl+C, detach and reattach after a reload,
  takeover revoking the agent's lease, ending the console, and the cap behaviour. It runs outside this repository's CI and is
  recorded with its date, the Sliver version and the target.

## Order of work

1. Verify the Sliver `Shell` mapping against the pinned version; record the result here.
2. Accept ADR-0098 and ADR-0099; implement the lease and the run attribution.
3. Bridge `pty.*` operations behind a feature flag, off by default.
4. Web API and storage, then the console panel.
5. Native lab gate. Only then consider the ADR-0095 status change.
