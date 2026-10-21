# ADR-0095: Interactive C2 console (PTY) — supersedes the Shell/PTY clause of ADR-0036

**Status: Proposed** — 2026-10-21. Supersedes only the clause of ADR-0036 that puts the interactive `Shell` RPC and the PTY console out of scope. Every other decision in ADR-0036 stays in force.

## Context

The product foundations proposal (2026-10-21, §3) asks for an operator console that keeps shell state: `cd`, environment variables, interactive programs and Ctrl+C. Single-shot execution cannot provide these. On 2026-10-21 the owner decided the following (proposal §3.5):

- Full PTY: `cd`, environment and Ctrl+C are preserved.
- One provider namespace per project, shared by Web and agent. An asset-to-session binding is required; a session is never inferred from a description.
- Closing the tab detaches. Reload or network loss reattaches while the session is alive. Ending the console uses an explicit control.
- One controller at a time. When an operator takes over, the agent yields.
- Metadata and outcomes live in PostgreSQL. The transcript is a retained artifact, proposed at 100 MiB per console session with 30-day retention. Reaching the limit is shown explicitly.

## Decision

1. **Typed PTY operations** on the existing Sliver bridge: open, input, resize, detach and terminate, following ADR-0036's typed-bridge pattern. The browser never sends raw RPC or shell text except into a session the engagement owns.
2. **Explicit shell executable.** The operator names the shell executable for each console. No implicit shell is inserted, as ADR-0036 requires.
3. **Same authority as single-shot execution.** Engagement ownership, authorization, time-limited grants and emergency stop apply to console sessions exactly as they apply to single-shot execution. Authorization is checked before every provider call.
4. **One controller.** A controller lease is recorded in PostgreSQL. Exactly one party holds it. An operator takeover revokes the agent's lease, and the agent cannot retake it while an operator holds it.
5. **Lifecycle.** Closing the tab detaches. Reattach works while the implant session is alive. The explicit end-console control terminates the PTY process; it does not terminate the implant session.
6. **Storage.** PostgreSQL holds console metadata, lease history and outcomes. The transcript is a retained artifact capped at 100 MiB per console session, with 30-day retention. Reaching the cap writes an explicit truncation marker, and the console shows it.
7. **Unchanged.** Single-shot execution and its command ledger keep the behaviour ADR-0036 defines.

## Threat model

- **Assets:** operator-owned lab targets and their sessions. **Actors:** a compromised browser session, a user without a grant, or a model acting through the agent.
- **Controls:** engagement ownership and authorization before every provider call; grant expiry and emergency stop revoke input; the single-controller lease prevents interleaved input; the bridge enforces output and input bounds and never forwards to a session it does not own.
- **Residual risk:** a transcript can hold credentials that were typed or printed on the target. Transcript access follows the same role and masking rules as evidence. Retention is 30 days. Transcript content never enters logs or public DTOs.
- **Denial of service:** input and output rates are bounded at the bridge; the 100 MiB cap bounds storage.
- **Unknown outcomes:** an input whose outcome is uncertain is never resent (the ADR-0036 rule for synchronous execution applies).

## Verification

Required before this ADR is Accepted: a native lab gate on an isolated target container with a real implant session. The gate covers open, `cd` and environment persistence across inputs, Ctrl+C, detach and reattach after reload, takeover revoking the agent lease, end-console termination, and cap behaviour. UI fixtures do not count as evidence.

## Consequences

- The bridge gains a PTY stream surface and new state: leases, console metadata and transcript artifacts.
- ADR-0084's C2 transcript gap stays until this ADR is Accepted and the console UI exists.
- Open before Accepted: the exact Sliver `Shell` RPC mapping and its failure modes; transcript masking rules; the lease timeout value.
