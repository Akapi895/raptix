# ADR-0103: A workspace finding is confirmed only by a separate verifier that re-runs its sealed Proof of Concept

- **Status:** Proposed
- **Date:** 2026-10-26
- **Deciders:** repository owner (approved the design in session on 2026-10-26); maintainer acceptance pending
- **Related:** ADR-0062 (differential verification, superseded by ADR-0063), ADR-0063 (Proposed), ADR-0100 (independent review before confirmation), ADR-0102 (project files only through the project sandbox). Guard rails touched: the RoE gated tool set in `middleware/roe.py`, and the tool surface of the `verifier` role.

## Context

A finding is written by a generator agent (`exploit`, `postexploit`, `recon`) into `findings/FIND-NNN.md` under the operational-tier template in `finding-protocol`. The template already requires a verification section before a finding is marked `confirmed`, and the verifier prompt already requires the tool's JSON to be saved as `findings/evidence/FIND-NNN_verification.json`. Nothing enforces either rule. In the engagement `CodePartTwo`, `FIND-001` was written by the exploit agent with status `confirmed`, has no `verification.json`, and names its PoC only as an evidence file, `FIND-001_payload.js`, with no field linking the finding to it.

The tool `validate_workspace_finding` already runs a PoC command and its baseline in the sandbox and returns `validated`. The verifier role (`intelligence/agents/plugins/verifier.py`) already has it in its tool set. But that role is attached only to the `vulnresearch` orchestrator through `parent_agents`, so the `raptix` orchestrator that runs engagements never dispatches it. Its tool set also contains `bash`, so a verifier can write its own command in place of the generator's, and its prompt tells it to "build the smallest reproduction".

Verdict quality depends on three things this ADR fixes: who decides, what the decider is allowed to change, and whether the command it runs is the command the generator wrote.

## Decision

1. **Generation (prompt level).** `finding-protocol` requires every new finding to carry `status: candidate` in its frontmatter. A finding that has a PoC also carries a `## Proof of Concept` section with one JSON object in a fenced block. The object holds `file` (the PoC path under `/workspace`), `poc_sha256` (SHA-256 of the PoC file), `payload` (a substring of `command` that carries the exploit), `command` (the PoC command), `success_patterns`, `negative_command`, `negative_patterns`, `cvss_vector`, and `spec_sha256` (SHA-256 of the canonical JSON of the object without `spec_sha256`). The generator never writes `confirmed` or `rejected`.
2. **Verification (separate actor).** The existing `verifier` role becomes the verification actor. It is an LLM agent. Its `parent_agents` gains `raptix`, so the engagement orchestrator can dispatch it. Its prompt covers only the workspace protocol. Its tool set is the read-only evidence tools plus one new tool, `verify_workspace_candidate(finding_id)`. It does not get `bash`, `validate_workspace_finding`, or any write tool for findings.
3. **The verdict comes from the tool, not from the model.** `verify_workspace_candidate` takes only the finding id. It reads the sealed block from the finding file and never takes a command, pattern or CVSS vector from the model. It runs the PoC through `validate_workspace_finding` with the values from the file. It writes `findings/evidence/FIND-NNN_verification.json` verbatim, with the hashes it checked, and sets `status` to the verdict. `confirmed` is written only when the tool returned `validated=true` for this PoC.
4. **Seal check.** Before running, the tool recomputes `spec_sha256` over the block and compares it with the stored value. It then hashes the PoC file and compares it with `poc_sha256`. A mismatch is a refusal. The refusal is recorded, and the status becomes `candidate`, so a finding changed after confirmation loses its confirmation.
5. **Baseline and pattern checks in code.** The payload must occur exactly once in `command`. `negative_command` must equal `command` with the payload removed, after whitespace is normalized. Each pattern must compile, must not be shorter than four characters, must not match the empty string, and must not contain a comma, because the underlying tool splits on commas. Any failure is a refusal before anything runs.
6. **Verdicts.** `validated=true` gives `confirmed`. A run that completed without validating gives `rejected`. A run that did not complete (timeout, sandbox error) or a refusal gives `candidate`, so the finding can be verified again.
7. **RoE applies to the re-run.** `verify_workspace_candidate` joins the RoE gated tool set, so the abort marker, the time window and the audit ledger apply to it. Inside the tool, the targets of both commands are checked with the same RoE functions the middleware uses for `bash` (`evaluate_command`, `extract_targets`, `evaluate_target`). An unreadable RoE document refuses the call.

## Consequences

- **Easier:** a confirmed finding has a verification record that names the exact PoC bytes and command that were run. The verdict is the tool's output, so two runs of the same sealed PoC give the same verdict. The orchestrator can dispatch verification for the engagement, not only for the vulnresearch pipeline.
- **Harder:** a generator must compute two hashes and write a JSON block. A PoC that does not run without its payload cannot be verified, because the baseline check requires the payload to be removable.
- **Given up:** a verifier cannot adapt a PoC, start a target, or fix a broken command. Such a case is recorded as `candidate` with a reason, and a generator must write a new sealed PoC.
- **Migration:** the `verifier` prompt is rewritten for the workspace protocol. Its `bash` access is removed, so the `vulnresearch` pipeline loses the verifier's ability to stage PoCs with `bash`. Existing `FIND-*.md` files without a PoC block stay `candidate` until verified or re-generated.

### Limits this design does not close

- Nothing in code checks that a success pattern proves the impact the finding claims. The tool checks that the pattern matches the proof output and does not match the baseline. Whether that match shows the claimed impact stays a review task, which the four-eyes review in ADR-0100 covers before a finding enters a report.
- A generator that rewrites both the PoC file and its seal before verification is not detected by the seal. The seal detects changes made after the seal was written.
- A generator with `bash` can still write `status: confirmed` into the finding file directly. Closing this needs a gate on the server or the web side that requires `verification.json` with `validated=true` before a finding is shown as confirmed. That gate is a follow-up and is not part of this ADR.
- The web application does not yet display the verdict.

## Threat model

The verifier re-runs an exploit against a target, so it is an active action on the target. Its scope is controlled in three places: the RoE gate on the tool call, the target check inside the tool on both commands, and the sealed command, which the verifier cannot change. The 60-second timeout of the sandbox runner bounds each run. The RoE and abort checks fail closed when the project sandbox cannot be read. A sealed PoC cannot be widened to other hosts after generation, because the seal covers the command, and any change breaks the seal.

## Alternatives considered

- **A deterministic verifier node without an LLM.** Rejected for now: the verifier needs to decide when to refuse and how to report a refusal, and the repository's existing verifier role already provides that. The verdict is still made by the tool, so the LLM cannot change it.
- **A new verifier role separate from `verifier`.** Rejected because the role already exists, and two roles with the same job would drift apart.
- **The generator writes the verdict.** Rejected because it removes the separation this ADR exists to create.
