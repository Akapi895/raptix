# Stage 2 evidence traceability research

2026-10-11. Source inspection of the current working tree; recommendations below are prospective.
Runtime paths below are relative to `packages/raptix/raptix/`; Core paths to `packages/raptix-core/raptix_core/`.
Read [ADR-0049](../adr/0049-evidence-model-extends-capability-contract.md) and [ADR-0060](../adr/0060-project-recorded-claims-through-existing-kg-context.md); implementation claims here come from source, not their prose.
Auto-ingest/materialization is a separate investigation; this note covers producer/consumer and filesystem boundaries.

## Initial recommendation

**Use explicit sandbox-produced proof/control files and `inspect_evidence` as the first 2A consumer.**
The existing HTTP download seam can retrieve file bytes; current inspection does not resolve finding-specific raw evidence.
For 2B, one narrowly specified differential-response claim can reuse `validate_evidence` after resolving both captures.
Neither a clean custody manifest nor an agent-authored `validated` property establishes the security claim.

Implementation scope was subsequently narrowed in ADR-0061: registry auto-ingest
retains scanner captures and `inspect_evidence` checks parser-output membership.
The proposed proof/control lane below is prospective, not implemented security verification.

## What exists and who owns it

- **Raw producer:** [`execution/tools/bash/bash.py:bash`](../../packages/raptix/raptix/execution/tools/bash/bash.py) executes through `get_sandbox(config)` and the resolved workspace.
  Commands can retain their original output directly in workspace files. Returned text is sanitized/compressed; `_offload_large_output` retains that processed text only for non-root workspaces, with scratch pruning after 60 minutes.
  This is not durable raw evidence; at `/workspace`, large output is truncated without scratch retention.
- **Terminal capture:** [`execution/sandbox/kernel/tmux.py:TmuxSessionManager._setup_pipe_pane_logging`](../../packages/raptix/raptix/execution/sandbox/kernel/tmux.py) appends terminal output to `<workspace>/.sessions/<log-name>.log` in the daemon.
  `_truncate` masks large returned screens. A terminal transcript is session-wide, not a finding-specific stdout/stderr artifact.
- **Recording writer:** [`execution/tools/evidence/asciicast.py:export_asciicast`](../../packages/raptix/raptix/execution/tools/evidence/asciicast.py) reads local UTF-8 text with replacement, splits markers, and writes `.cast` plus a metadata sidecar.
  `list_recordings` reads those sidecars without verifying their referenced files. Conversion is not exact-byte retention.
  [`execution/tools/evidence/tools.py:export_session_asciicast`](../../packages/raptix/raptix/execution/tools/evidence/tools.py) defaults to `.tmux-logs/<session>.log`, unlike the current `.sessions/` producer; explicit input paths are needed.
- **Custody writer/reader:** [`execution/tools/evidence/tools.py:seal_evidence/_verify_manifest`](../../packages/raptix/raptix/execution/tools/evidence/tools.py) use process-local `Path` I/O, not an HTTP backend.
  Sealing appends relative path, SHA-256, byte size, timestamp, chained hash and optional HMAC for every current file below `evidence/`; it neither copies raw output nor associates files with findings.
  `verify_evidence` and `inspect_evidence` read that manifest; the latter returns whole-workspace custody, all recordings, finding props, and one-hop linked-node identities, not linked-node props or raw contents.
- **Reference contract:** [`Core types/capability.py:Artifact/Observation`](../../packages/raptix-core/raptix_core/types/capability.py) provide opaque artifact reference, optional SHA-256/producer/metadata, and source artifact/parser IDs.
  These dataclasses do not retain or resolve bytes. Cross-reference: [`execution/tools/research/ingest_services.py:_parse_content`](../../packages/raptix/raptix/execution/tools/research/ingest_services.py) hashes supplied bytes into a `sha256://` descriptor, then parses them; it does not write a retained copy or a lookup mapping.

## Host versus sandbox resolution

- [`execution/backends/factory.py:build_sandbox_backend/_resolve_endpoint`](../../packages/raptix/raptix/execution/backends/factory.py) prefers explicit per-run config; ambient config is insufficient in subagent contexts.
  [`middleware/filesystem.py:FilesystemMiddleware._get_backend/_rebind_sandbox_per_run`](../../packages/raptix/raptix/middleware/filesystem.py) passes `runtime.config` and wraps the result in `EngagementFilesystemBackend`, which maps virtual paths and exposes `download_files`.
- [`execution/backends/http_sandbox.py:HTTPSandbox.download_files`](../../packages/raptix/raptix/execution/backends/http_sandbox.py) decodes base64 into bytes; [`execution/sandbox/kernel/daemon.py:DaemonSandbox.download_files`](../../packages/raptix/raptix/execution/sandbox/kernel/daemon.py) reads bytes inside the sandbox.
  [`execution/sandbox/server/app.py:download_files/_check_file_paths`](../../packages/raptix/raptix/execution/sandbox/server/app.py) checks resolved containment under `/workspace` for a pinned engagement; without a pinned engagement that additional check is absent.
  Limitation: the HTTP client maps empty base64 to `content=None`, while the daemon returns `b""` for an empty file. Empty is currently indistinguishable from unavailable content without examining/fixing this boundary.
- Custody, recording export, `report_sarif`, and bounty report writes run in the agent process filesystem.
  This can be the same data in local Compose: [`docker-compose.yml`](../../docker-compose.yml) binds the same engagement source at `/workspace` in both sandbox and langgraph services.
  It is not a per-run transport guarantee: evidence `_workspace()` uses `RAPTIX_ENGAGEMENT_WORKSPACE` or `/workspace`, not injected `workspace_path`/`sandbox_url`; remote per-engagement endpoints need explicit scoped resolution.

## Existing consumer semantics

- [`knowledge/graph/summary.py:_recorded_claims/_render_claims/build_summary`](../../packages/raptix/raptix/knowledge/graph/summary.py) optionally projects five bounded Candidate/Hypothesis rows as explicitly unverified, with writer/episode attribution only.
  [`middleware/kg.py:_hydrate_kg_state/_inject_kg_context`](../../packages/raptix/raptix/middleware/kg.py) refreshes on KG revision and injects cached context; filesystem drift alone cannot invalidate that cache. Summary rows expose graph keys, not resolved artifacts.
- [`execution/tools/research/semantic.py:search_knowledge/inspect_asset`](../../packages/raptix/raptix/execution/tools/research/semantic.py) read the engagement graph: search returns node IDs/labels, inspection returns props and neighbor identities. Neither reads raw evidence.
  [`execution/tools/reporting/kg_adapter.py:load_engagement_graph`](../../packages/raptix/raptix/execution/tools/reporting/kg_adapter.py) reconstructs node IDs and keeps nonreserved props, including source artifact/parser IDs, but strips writer/episode reserved props.
  `inspect_evidence` needs this reconstructed node ID; a workspace `FIND-001` or summary key is not automatically that ID.
- [`execution/tools/reporting/tools.py:generate_report/_load`](../../packages/raptix/raptix/execution/tools/reporting/tools.py) reads KG projections, not evidence files.
  [`hackerone.py:render_hackerone_markdown`](../../packages/raptix/raptix/execution/tools/reporting/hackerone.py) prints supplied references and command/excerpt, even deriving default impact from severity; [`sarif.py:render_sarif`](../../packages/raptix/raptix/execution/tools/reporting/sarif.py) includes Vulnerability/Finding nodes without verification filtering.
  [`executive.py:render_executive_summary`](../../packages/raptix/raptix/execution/tools/reporting/executive.py) labels truthy `validated` vulnerabilities; [`research/bounty.py:format_bounty_report`](../../packages/raptix/raptix/execution/tools/research/bounty.py) gates on that property and writes an excerpt-based report locally. None resolves custody or rechecks raw proof.
- **File-evidence lane:** [`Core types/engagement.py:Evidence/Finding`](../../packages/raptix-core/raptix_core/types/engagement.py) declare workspace-relative evidence paths and optional hashes, not a resolver.
  [`apps/web/server/src/services/findings-service.ts:FindingsService.list/parseFindingMarkdown`](../../apps/web/server/src/services/findings-service.ts) reads host `findings/FIND-*.md`, returns bounded Evidence-section text/raw source and parser-quality flags; it does not follow evidence links or verify hashes/manifests.
  Its engagement directory comes from [`security/workspace-policy.ts:resolveEngagementWorkspaceDir`](../../apps/web/server/src/security/workspace-policy.ts), not the HTTP sandbox. File findings and KG findings are separate projections, not an automatic bridge.

## Integrity and verification outcomes today

- `_verify_manifest` returns `ok`, `records_checked`, `drift`, `missing`, `chain_errors`, or a missing-manifest error. An empty manifest is `ok=True`; files added after sealing are not checked.
  Resealing changed paths appends new records but old records are still compared to current bytes. Record paths are joined without containment checks; files/symlinks are followed. Sealing does not validate the existing chain first or lock concurrent appends.
  HMAC is optional ([`middleware/_audit_sink.py:_record_hash/_record_hmac`](../../packages/raptix/raptix/middleware/_audit_sink.py)); without a key, recomputable hashes detect accidental drift, not authenticated provenance. A valid prefix after tail deletion also passes because no external head/count is checked.
- **Actual wired verifier:** [`intelligence/agents/plugins/verifier.py:_STANDARD_TOOLS`](../../packages/raptix/raptix/intelligence/agents/plugins/verifier.py) includes `validate_workspace_finding` and evidence tools.
  [`execution/tools/plumbing/verification.py:validate_workspace_finding`](../../packages/raptix/raptix/execution/tools/plumbing/verification.py) requires proof/control patterns and CVSS, invokes `validate_poc` without a graph, and returns JSON; persisting it is only a docstring instruction.
- [`execution/tools/research/poc.py:validate_poc/sandbox_runner/_persist_result`](../../packages/raptix/raptix/execution/tools/research/poc.py) uses caller-defined regex signals and optional control, permits substring fallback for invalid regexes, and does not gate validation on exit status.
  The runner returns a possibly truncated tmux string, empty separate stderr, and an inferred exit code; it does not pass run config/workspace. `validate_workspace_finding` also calls `get_sandbox()` without config.
  Output identity is truncated SHA-1 of returned text/stderr/code, not a raw-file integrity hash. Full baseline output is discarded; graph mode persists only a short positive excerpt and booleans/edges. `validate_finding` does not return the newly created finding ID despite `inspect_evidence`'s docstring suggestion.
- [`specialist_contracts/evidence.py:validate_evidence/validate_evidence_files`](../../packages/raptix/raptix/specialist_contracts/evidence.py) is the stricter reusable technique: positive success, baseline signal, no success in baseline, invalid regex rejected.
  The file helper confines distinct local paths but decodes with replacement and checks no digest. Current production references are exports, not callers. Both validator families return boolean validation, not supported/contradicted/inconclusive semantics.

## Smallest viable slice to implement next

1. **2A producer:** use existing `bash` command output flags/redirection to retain one immutable proof capture under engagement `evidence/`, later a distinct control capture. Keep original bytes rather than terminal previews or `.cast` reconstruction.
2. **Association:** bind the captures' existing `Artifact` descriptors (including producer, SHA-256 and explicit engagement-relative locator metadata) to one existing KG claim through [`knowledge/graph/tools.py:build_kg_tools.kg_record`](../../packages/raptix/raptix/knowledge/graph/tools.py) props. This binding/retention is missing today; an opaque digest/episode URI alone is not resolvable.
3. **2A consumer:** extend `inspect_evidence` at its existing node/props seam to resolve those locators through the run-config-bound `EngagementFilesystemBackend.download_files`. Check containment, missing/error/empty/size and digest before decoding; keep bounded untrusted display separate from exact retained bytes. Report finding-specific integrity independently of workspace custody.
4. **One 2B claim:** “the proof marker occurs in the payload response but not the matched ordinary baseline.” Reuse strict `validate_evidence` on the two integrity-checked snapshots. This supports that differential observation, not generic exploitability, CVSS impact, or independent corroboration.
   Proposed outcomes: supported when all strict checks pass; contradicted when a valid ordinary baseline also contains the success marker (refuting the differential claim); inconclusive for missing/drifted captures, invalid patterns, unmatched baseline, timeout/truncation, or absent positive signal without adequate contrary evidence. Preserve these reasons separately from retrieval/integrity status.
5. `validate_workspace_finding` is the existing live proof/control execution seam if automatic capture is needed later; fix explicit routing/retention there rather than constructing a store/executor framework. Its `FIND-001` does not itself create a KG node for inspection. Keep the summary projection unverified until a real check is bound to the retained captures.

## Meaningful test seams and verification performed

- [`tests/unit/tools/test_evidence_tools.py`](../../packages/raptix/tests/unit/tools/test_evidence_tools.py) covers seal/drift/missing/chain and inspection, but inspection patches graph loading and seeds unrelated local files; it does not prove finding-specific resolution or remote routing.
- Extend scoped-download behavior in [`tests/unit/middleware/test_filesystem.py`](../../packages/raptix/tests/unit/middleware/test_filesystem.py) and HTTP bytes in [`tests/unit/backends/test_http_sandbox.py`](../../packages/raptix/tests/unit/backends/test_http_sandbox.py): two endpoints with the same virtual filename but different bytes, explicit subagent config, binary/non-UTF-8/empty/missing files, symlink escape, and digest drift before display/verification.
- Reuse [`tests/unit/specialist_contracts/test_evidence.py`](../../packages/raptix/tests/unit/specialist_contracts/test_evidence.py) and [`tests/unit/tools/test_verification.py`](../../packages/raptix/tests/unit/tools/test_verification.py): proof/control differential, noise in control, missing baseline, invalid regex, transport failure, and altered capture. Exercise real sealing/resolution/validation, mocking only transport/target; assert no security promotion from custody alone.
- Attempted focused existing suites with `uv run --no-sync pytest ... -p no:cacheprovider` (120s timeout), then the pure evidence suite with offline/no-sync and empty addopts (60s timeout); both produced no output before timeout. No passing test or live-sandbox verification is claimed. Runtime/tests were not edited.
