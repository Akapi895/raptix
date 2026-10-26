# ADR-0104: An operator reproduces a finding's sealed Proof of Concept from the console, and a reproduction never writes a verdict

- **Status:** Proposed
- **Date:** 2026-10-26
- **Deciders:** repository owner (approved the design in session on 2026-10-26); maintainer acceptance pending
- **Related:** ADR-0103 (verified PoC gate; the verifier alone writes verdicts), ADR-0100 (independent review before confirmation), ADR-0102 (project files only through the project sandbox; RoE and abort fail closed), ADR-0087 (capture classification). Guard rails touched: RoE enforcement (`middleware/roe.py`, `candidate_verification.py`), the emergency `.abort` marker, and the web API's run path.

## Context

ADR-0103 gives a finding a sealed Proof of Concept (PoC) block. Only the verifier tool runs it, and only the verifier writes a verdict. The console's Reproduce tab shows the producer evidence and the capture bytes, but it cannot run anything. An operator who wants to see the PoC work again has to copy the command out of the finding and run it by hand, outside the RoE gate and the audit trail.

Some PoCs need a value that the operator supplies at run time, such as a session token. Storing that value on the finding or in the vault would keep a credential the operator did not choose to keep. The seal covers the payload, so the value must not be part of the payload.

## Decision

1. **Read.** The runtime reads the sealed PoC block of `findings/FIND-NNN.md` from the project sandbox and returns it, with a seal check. The console shows the command, the patterns, the CVSS vector and whether the seal holds. The read changes nothing.
2. **Run-time parameter.** A sealed `command` and `negative_command` may contain the placeholder `{{TOKEN}}` outside the payload. The value an operator types for a run must be one token of letters, digits and `._+/=:@%-` (1 to 512 characters). Any other value is refused. The value replaces every placeholder only in the command that is executed. The seal is checked against the sealed form, which keeps the placeholder, so the seal does not depend on the value.
3. **Run.** The web API accepts the run from an owner or operator of the engagement, records an audit entry without the value, and calls a runtime endpoint with the runtime API token. The runtime applies the verifier's gates to the executed command: the seal check, the structural checks (`check_candidate`), the `.abort` marker, and RoE for the time window, the command and each target. Then it runs the positive and the negative command in the project sandbox.
4. **Result.** The result shows whether each pattern matched and a truncated output excerpt. The runtime writes `findings/evidence/FIND-NNN_reproduce_<UTC timestamp>.json` with the sealed command (placeholder kept), the outcome and the output excerpt. It never writes the value.
5. **No verdict.** A reproduction never changes `status` in the finding and never writes `findings/evidence/FIND-NNN_verification.json`. Only `verify_workspace_candidate` does that (ADR-0103).

## Consequences

- **Easier:** an operator sees the PoC work again from the finding, through the same gates as the verifier and with an audit entry.
- **Harder:** a run from the console is an active action on the target. It needs a reachable project sandbox and an unexpired RoE window, and it fails closed when either is missing.
- **Given up:** a reproduction is not evidence for the finding's status. A reader who wants a verdict must still run the verifier.
- **Follow-up:** the finding protocol must document the `{{TOKEN}}` placeholder before generators use it. That change is not part of this ADR.

## Threat model

- **Shell injection through the value.** The value must match `[A-Za-z0-9._+/=:@%-]{1,512}`. That set has no quote, space, `;`, `|`, `&`, `$` or backtick, so the value cannot add a word or a command, whether the placeholder sits inside quotes or not. Any other value is refused before anything runs.
- **The value leaks.** The value is kept in memory for one request. It is not stored, not written to a file, not written to the audit entry and not returned. Output that repeats the value is redacted before it leaves the runtime.
- **A reproduction goes out of scope.** The gates run on the executed command, so a value that adds a target is refused by RoE. The sealed command is what the seal covers, and the placeholder cannot widen the payload.
- **A viewer runs an exploit.** The web API refuses viewers and requires an owner or operator role. The runtime also requires the runtime API token.
- **A reproduction hides a failed verification.** Reproduction writes no verdict and leaves the status unchanged, so a finding cannot become `confirmed` through this path.

## Alternatives considered

- **Run the PoC through an agent.** Rejected: the agent decides the command, so the result is not the sealed PoC, and the run is not deterministic.
- **Store the value in the vault.** Rejected by the owner: the operator enters the value for each run.
- **Let the reproduction set the verdict.** Rejected: it would let an operator confirm a finding without the independent verifier that ADR-0103 requires.
