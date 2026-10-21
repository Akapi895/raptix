# ADR-0036: Sliver C2 sessions and HTTP C2 Profiles via a typed gRPC bridge

Status: Proposed (IW-09 implementation in progress). The Shell/PTY clause below is superseded by ADR-0095 (Proposed).

## Decision

The operator confirmed on 2026-10-03 that IW-09 covers Sliver sessions plus
**HTTP C2 profiles** (the native `GetHTTPC2Profiles` /
`GetHTTPC2ProfileByName` / `SaveHTTPC2Profile` RPC family), not implant build
profiles. Command dispatch accepts an explicit binary path plus an argument
array with audit logging, and session ownership maps through per-engagement
lab listeners.

Sliver v1.7.7 uses the official linux-amd64 release binary, verified against
SHA256 `10c78c3b6e9398797d3c1546c95c2db507f64d4bbd9932068a89ee4a8889e0c5`.
Protobuf definitions are pinned by commit `0aa7e5b` (tag `v1.7.7`). The bridge drives it over its native gRPC
operator interface (mTLS plus per-RPC token from the generated operator
config). No shell text crosses the API boundary: commands are `Execute`
requests with `Output` set, a fixed environment policy and a bridge-enforced
deadline. The interactive `Shell` RPC and the PTY console were out of scope; ADR-0095 supersedes that clause.

## Scope and threat model

Typed operations only: session list/get, single-shot execute, HTTP C2 profile
list/create (name-scoped, lab-default traffic config cloned from the native
default), lab listener start/list and listener job kill. Implant generation is
a lab-harness-only operation used to enrol a test session; the browser can
never request implants, listeners outside the lab port range, arbitrary
profile traffic config or specialized pivoting/file-transfer RPCs. Explicit
path + argv is operator-controlled execution on the owned target, as approved
by the operator. Choosing a shell executable explicitly does not turn the
bridge into a generic shell forwarding API; no implicit shell is inserted.

Each engagement owns lab listeners on distinct ports. A session is visible to
an engagement only when its native `ActiveC2` endpoint matches an owned
listener endpoint; unattributed sessions are hidden, never fabricated.
Engagement authorization precedes every provider call. Command history
(request identity, path, args, exit status, bounded output) persists scoped
to the owning engagement; outputs are size-bounded and truncated explicitly.
Operator keys, tokens and server certificates never appear in public DTOs.
The mounted private state volume contains native keys and is operator secret
storage. TLS verifies the operator CA and native `multiplayer` server name.
The native compiler's environment excludes the HTTP bridge token.

State lives under `/state/sliver`, listener/session ownership and native
command outcomes under `/state/ownership.sqlite`, and web command audit under
PostgreSQL `C2Command`. Retired listener ports are not reused. On graceful
restart the bridge restores owned listener intents and observes reconnecting
implants; unattributed sessions remain hidden. Synchronous execution timeouts
can be uncertain: the same request is never dispatched again, and inspection
can only recover an outcome actually recorded by the bridge. An irrecoverable
unknown outcome retains the web session lock; automatic retries are not safe.

## Verification

Unit tests must exercise the client validation and the service ownership
rules against fixtures, including cross-engagement denial and unattributed
sessions. A native lab gate is required: a real implant session enrolled in
an isolated target container, listed and commanded through the actual API,
with restart/reload persistence, idempotent command retries and output
bounds. IW-09 remains open until that gate passes.

Observed 2026-10-04 on base `7c399a5` plus IW-09 working tree: 22 native
checks passed against Sliver 1.7.7, PostgreSQL, a Linux HTTP implant using
the scoped HTTP profile, and a real-mode browser without API interception.
Audit output survived API restart; listener/profile ownership survived bridge
restart and implant reconnect. Evidence: `test-results-deployed/iw09/native.json`
and `native-c2.png`. A stable rerun harness is
`clients/web-raptix/tools/verify-sliver-lab.mjs`. This is local lab evidence,
not a cutover of the normal port-3000 deployment or a hosted/power-loss claim.
