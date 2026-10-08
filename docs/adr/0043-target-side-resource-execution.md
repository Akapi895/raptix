# ADR-0043: Target-side resource execution (Linux PE tooling)

## Status: Accepted (2026-10-07)

Accepted decision: the packaging/parsers half (resource manifest with
verified digests + `peas_txt` / `pspy_log` T3 parsers) is delivered;
the transfer/execution half remains gated on the threat-model review
item 4 below plus a separate reviewed PR (one concern per PR) — no
target-side execution path lands with this ADR alone.

## Context

Plan package TC-4 (Linux post-exploitation resources) asks the runtime to
place *target-side resources* — pre-compiled Linux privilege-escalation
enumerators such as LinPEAS/PEASS-ng and background job watchers such as
pspy — on a compromised sandbox target and execute them there. Today the
sandbox executes only binaries installed in its own image: agent-side
`COMMAND` payloads run inside the sandbox container, never on a captured
remote host.

Every existing guardrail assumes this boundary: the sandbox's egress
rules, RoE checks, output capture, and the artifact/artifact-store chain
all observe execution that happens *in the sandbox*. Pushing an arbitrary
compiled resource onto a target and running it there bypasses every one
of those observation points and creates a class of execution the runtime
cannot currently see, bound, or audit.

For that reason, TC-4's own plan entry (D3) gates implementation behind
this ADR: "Before implementing resource support, propose an ADR
specifying the resource packaging contract, the sandbox-to-target
transfer mechanism, execution semantics, and how version/dependency
metadata is recorded — it is accepted before any resource code lands."

## Decision

**Resource support is split into two independently reviewable halves, and
only the packaging half is deliverable without further sign-off.**

### Half 1 (this ADR, shipped): a pinned resource manifest — data only

`infra/resources/target-linux.json` declares, per resource, exactly what
TC-4's item 1 asks for: pinned upstream release, architecture, upstream
digest, and the artifact-format the resource's output uses:

```json
{
  "resources": [
    {
      "id": "linpeas",
      "kind": "pe_enumerator",
      "version": "<operator-pinned PEASS-ng release tag>",
      "architectures": ["amd64"],
      "upstream_url": "https://github.com/peass-ng/PEASS-ng/releases/…",
      "sha256": "<digest verified by the operator at packaging time>",
      "output_format": "peas_txt"
    },
    {
      "id": "pspy64",
      "kind": "process_watcher",
      "version": "<pinned pspy release>",
      "architectures": ["amd64"],
      "upstream_url": "https://github.com/DominicBreuker/pspy/releases/…",
      "sha256": "<digest>",
      "output_format": "pspy_log"
    }
  ]
}
```

Rules enforced by review and by the eventual loader tests:

* digests are REQUIRED — a manifest entry without a verified sha256 is a
  defect, never a "will fill in later" field;
* version markers without verified digests are not packaged; the
  manifest is the single place a resource is pinned;
* the manifest lives in `infra/` (build-time, operator-owned) — the
  runtime never fetches resources from unpinned URLs.

### Half 2 (deferred, needs the threat model below): transfer + execution

The sandbox-to-target transfer mechanism, execution wrapper, output
retrieval, and cleanup are NOT implemented here. Before any of that
lands, the following must be answered and accepted (updates to this ADR
or a successor):

1. **Transfer mechanism.** Upload through the same guarded channel the
   sandbox already trusts for target-side files (existing
   `upload_files`-style flow plus an explicit allowlisted per-execution
   temp dir), never through the agent's general filesystem tools.
2. **Execution semantics.** Resources execute under the target-side
   tmux background pattern with a bounded timeout, output captured to a
   named artifact, and the temp dir removed afterwards. There is no
   interactive target-side shell owned by the resource.
3. **Provenance.** The executed resource id + version + digest travel in
   `ExecutionProvenance` fields (mirroring TC-3's manifest→provenance
   chain). An execution without provenance for a resource run is a bug.
4. **Blast radius.** Resource execution is CRITICAL-risk
   (`RiskClass.CRITICAL`), `parallel_safe=False`, postexploit/exploit
   roles only, and requires the same HITL gates as any
   exploit-execution-path change (`.semgrep` raptix-no-* rules apply to
   any new dispatch code).
5. **Telemetry.** Resource metadata (id, version, digest, target host
   reference) may be recorded; parameter values and captured plaintext
   never leave the engagement-scoped KG.

## Consequences

* TC-4 stops at the packaging manifest + this ADR until Half 2's threat
  model review passes; the plan's "no resource execution without this
  ADR" gate stays intact.
* The manifest gives benchmarks a stable, auditable inventory of
  target-side resources *before* any execution path exists — no
  undeclared-claim gap can hide behind "we ship it somewhere".
* When Half 2 is approved, parsers (`peas_txt`, `pspy_log`) follow the
  same T3 ParserRegistry + T9 parser pattern used by every other
  format, keeping normalization deterministic and testable.
