# ADR-0105: A WebShell session is a typed request/response provider, and direct use requires single-operator mode

- **Status:** Proposed
- **Date:** 2026-10-26
- **Deciders:** repository owner (design direction agreed in session on 2026-10-26); maintainer acceptance pending
- **Related:** ADR-0100 (single-operator mode), ADR-0102 (project files only through the project sandbox), ADR-0103 (only the verifier writes a finding verdict), ADR-0104 (a console reproduction never writes a verdict), ADR-0096 (feature-owned Web presentation and adapters), `docs/design/2026-10-26-webshell-sessions-milestone-2-implementation-plan.md`

## Context

The Sessions tab currently speaks only to the C2 provider. In the `bashed` lab the working primitive is not a C2 implant: it is a `phpbash` endpoint that accepts one form-encoded command and returns stdout. No bind or reverse shell is needed, and the target cannot reach the sandbox. C2 is also unavailable in the current deployment, which must not prevent an operator from using the primitive that does work.

The finding already carries a sealed PoC that proves the primitive. Re-running that PoC by hand, then retyping its endpoint and parameter into a separate tool, loses the link between the finding and the session. Automating the link needs a decision about where the session record lives, how commands are executed, and what a model may decide.

The deployment is run by one person, but the server still requires an independent actor for consequential decisions. A WebShell console that only appears through grants would be unusable until a second account exists. Single-operator mode already exists for workflow decisions (ADR-0100); extending it to direct WebShell use is a new decision, not an interpretation of the old one.

## Decision

1. **A separate provider.** A WebShell is a provider with its own records and routes, not a `C2Command` row and not a Sliver session. Milestone 2 supports one provider, `http-form-command`: one HTTP request carries one command and one response carries the output. It is not a PTY and keeps no cwd or environment between requests.
2. **Web owns records; runtime owns execution.** The Web server persists connections, probes, commands and acquisitions in PostgreSQL and is the authority for state. The Python runtime validates a typed profile, applies RoE, time-window, abort and scope gates, and executes through the project sandbox. The Web server never sends a request to the target itself.
3. **Typed profile, not a curl string.** The wire profile names the endpoint, method, form parameter, allowlisted headers and a probe command/pattern. The executor builds the curl invocation with quoted arguments. Raw curl, credentials and arbitrary header names are not accepted.
4. **Direct access is gated on single-operator mode.** When `isSingleOperator()` is true, an engagement owner or operator may create, probe, execute and close a WebShell connection without a grant. Every request still passes membership, engagement-open, emergency-stop, approved-scope, RoE-window and target-in-scope checks. When the setting is false, WebShell mutations answer `403` with `webshell_direct_access_requires_single_operator`; the server never infers the mode from `authMode`, the capabilities `mode`, or a client flag.
5. **Acquisition derives, then asks a model only for a profile.** For a finding with a sealed PoC, the runtime extracts the request shape deterministically. If that fails, a model may return one of two JSON shapes: a typed profile or a refusal. The model has no tools, receives bounded untrusted data, and cannot set connection state or a finding verdict. Code validates the profile, checks the target set, and probes before the Web server creates a connection.
6. **No new shell on the target in this milestone.** Planting or uploading a WebShell is out of scope. That path writes new content to the target and needs its own threat model and ADR.
7. **No verdict.** Acquisition never calls `verify_workspace_candidate`, never changes a finding's `status`, and never writes `findings/evidence/FIND-NNN_verification.json`.

## Threat model

- **Out-of-scope endpoint (SSRF/scope bypass).** The profile endpoint host must equal the profile target, both must be in the engagement's allowed target set, and the runtime re-runs RoE evaluation on the endpoint host and the request command. Acquisition derives the allowed set from the sealed PoC, not from model text. An out-of-scope profile is refused before any probe.
- **Shell injection through the command or parameter.** The parameter name is a strict identifier. The command and probe command are passed as quoted `curl --data-urlencode` arguments, never interpolated into a shell string. Newlines and shell metacharacters remain data. A raw curl profile is not accepted.
- **Prompt injection in the PoC or a probe error.** The model has no tools and cannot execute anything. PoC bytes and error excerpts are bounded and labelled as untrusted data. The only accepted outputs are a typed profile or a refusal; free text is rejected.
- **Credential leakage.** Headers are limited to `User-Agent` and `Content-Type`; `Host`, `Authorization` and `Cookie` are refused. Command output is bounded, marked when truncated, and never copied into SSE notices or log messages. The profile view never carries a sandbox or runtime token.
- **Uncertain execution.** A timeout or dropped response after the request was sent is recorded as `uncertain`. The server does not retry it automatically. A new command is a new `requestId`.
- **Single-operator misuse.** The setting is off by default, is read once at startup, logs a warning, and is advertised as `independentReview: single-operator` on the capabilities document. A multi-user deployment that turns it on gives a stolen operator session direct target execution; that residual risk belongs to the deployment owner.
- **Cross-engagement access.** Every route resolves the engagement through `requireEngagementAccess(..., 'operator')` and treats a foreign id as 404. The runtime endpoint also requires the runtime API token. A foreign command or acquisition id is never looked up without the engagement predicate.
- **Duplicate or replayed mutations.** A client-supplied `requestId` is unique per engagement. A replay with the same payload returns the stored row; a changed payload under the same id is a conflict. One unsettled command per connection is enforced by a unique active-connection column.
- **A WebShell becomes evidence for a finding.** It does not. The connection records provenance (finding id, PoC hash, acquisition id) but acquisition leaves the finding and its verification file untouched.

## Consequences

- **Easier:** an operator can use the primitive that already works, and a finding can become a usable session without copying values between tools. C2 availability stops being a prerequisite for the Sessions tab.
- **Harder:** there are now two session providers with different state models. The Web server, runtime and UI each need their own WebShell validation and tests, and the runtime has one more execution path that must keep the RoE and abort gates intact.
- **Given up:** interactive PTY, bind/reverse shells, file transfer, non-form WebShells, arbitrary headers and credentials are not available in this provider. Direct access without single-operator mode is not available.
- **Migration:** new tables and routes only. Existing `C2Command`, `C2Grant`, Sliver and grant semantics are unchanged. The setting defaults to off, so existing deployments behave as before.

## Alternatives considered

- **Model a WebShell as a Sliver/C2 session.** Rejected: it would fake a session that does not exist, reuse C2 grant semantics that do not fit a form endpoint, and break when C2 is unavailable.
- **Let the Web server call the target directly.** Rejected: it bypasses the sandbox, the runtime token, and the RoE/abort gates, and creates a second egress path.
- **Let the model drive acquisition end to end.** Rejected: the model would choose and run target actions, which makes the result non-deterministic and defeats the sealed-PoC boundary.
- **Require a C2-style grant for every WebShell command.** Rejected for this milestone: a single-operator deployment cannot satisfy a two-person grant flow, and the existing single-operator decision already governs the deployment. The grant path remains the rule when the setting is off.
- **Store the profile as a raw curl command.** Rejected: validation and quoting become impossible to enforce, and the stored value becomes an execution language rather than data.
