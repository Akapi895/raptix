# Tool Capability Completion Implementation Plan

- **Date:** 2026-10-07
- **Status:** Proposed; planning only. No work package is implemented by this document.
- **Baseline:** `structure` at `8cc26df6e0d06273da7bfc55455086ed0756c53a`.
- **Goal:** Make advertised tool-backed capabilities executable, observable, reproducible, and verifiable in their declared deployment profiles.
- **Priority:** Complete existing execution chains first; add tools only for demonstrated coverage gaps.
- **Relationship:** Supplements [the tool-optimization implementation plan](../tool-optimization-implementation-plan.md). It does not change T0/T1 freezes, approve later waves, or replace wave sign-off. Code present in the branch is not evidence that a wave has been accepted.

## 1. Objective and scope

The question this plan answers is:

> Does every capability Raptix advertises have at least one declared, complete execution path that is healthy in its execution environment and can be benchmarked?

The primary mission is network red teaming: discovery, initial foothold, local privilege-escalation enumeration, credential use, pivoting, lateral movement, and objective completion. Web and AD remain core; domain-specific execution profiles follow explicit product commitments and benchmark workloads.

### In scope

- Audit advertised claims against manifests, implementations, executors/resources, parsers, skills, and execution evidence.
- Complete existing adapter-to-observation paths and wire them through the guarded runtime.
- Probe the actual sandbox, target resource, or sidecar rather than the agent process's PATH alone.
- Pin tool versions and mutable inputs used by benchmarks.
- Add Linux privilege-escalation resources, an offline credential cracker, and conditional Windows resources.
- Verify BloodHound collection end-to-end and complete the existing SNMP execution path.
- Add contracts/fuzzing and other domain profiles only when their execution capabilities are in scope.
- Produce a per-implementation coverage report and controlled execution benchmarks.

### Scope boundaries

- This is not a bulk security-package install or a larger model-facing tool menu.
- Existing binaries and mature upstream tools are preferred to custom replacements.
- Execution stays behind existing RoE, SafeCommand, engagement, egress, HITL, and budget boundaries. No approval or scope bypass is introduced.
- Exposure remains UX, not authorization. Recovery tools stay reachable; exposure enforcement requires the existing shadow-mode process. Changes to agent input are flag-gated and verified before enabling a new default.
- Existing functions remain importable. Consolidation changes registrations/list membership only, with re-export compatibility where required.
- Incalmo work remains within its approved safe subset. Parser/auto-ingest changes follow L2a/L2b; this plan does not authorize gating, blocking, or pruning lessons.

## 2. Verified baseline and evidence limits

These findings come from source inspection and an in-process catalog/adapter/parser inventory on the baseline commit. No Docker containers were running during that review; deployed binary health and live target behavior were not verified.

### 2.1 Current registries and adapters

`build_catalog()` contains **21 manifests**: twelve in-process capabilities, eight binary-backed capabilities, and one bounded-worker capability. `default_adapters()` supplies **eight binary-backed adapters**. The default ParserRegistry contains twelve formats.

| Adapter | Expected artifact format | Registered in default ParserRegistry |
|---|---|---|
| `network.nmap` | `nmap_xml` | Yes |
| `network.subfinder` | `subfinder` | Yes |
| `web.gobuster` | `gobuster` | Yes |
| `web.sqlmap` | `sqlmap_log` | No |
| `web.nikto` | `nikto_txt` | No |
| `ad.impacket.lateral` | `impacket_txt` | No |
| `ad.impacket.cred_dump` | `impacket_txt` | No |
| `ad.responder` | `responder_log` | No |

Parser presence for Nmap/Subfinder/Gobuster is not proof of a complete, live-tested chain. Conversely, a missing default parser does not mean a specialist cannot execute the binary directly through guarded bash; it means the declared adapter path cannot yet normalize that format through the default registry.

### 2.2 Profile and health limitations

- The sandbox declares opt-in web (`httpx-toolkit`, Katana, ffuf, Nuclei, testssl), AD (NetExec, Certipy, Evil-WinRM), and pivot (Ligolo-ng) profiles. Reversing has a separate opt-in/sidecar arrangement.
- Installing those packages does not register typed implementations for them. The current default adapter set does not include those profile executors.
- `AvailabilityEvaluator` defaults to import/attribute checks for Python carriers and local PATH checks for bare binary names. Those checks do not prove version compatibility, adapter registration, parser presence, or health in the deployed sandbox.
- T8 profile tests inspect Dockerfile/Compose text. They do not build an image or execute its binaries.
- T7 adapter tests use injected availability and canned output. Tool-eval Tier C also uses canned artifacts; its live end-to-end Tier D is reported as pending.
- Nuclei templates are recorded as runtime-fetched, not pinned. Package version manifests record versions; they do not make mutable package repositories reproducible.

### 2.3 Capability wording that must remain accurate

- `analyst.fuzz_target` currently classifies source and generates a harness. It does not execute a fuzz campaign. C/C++ defaults to libFuzzer; the AFL++ entry currently reuses the libFuzzer template.
- Contract plugin tools perform offline Solidity pattern analysis and generate Foundry test source. They do not run Slither or Forge. `contracts.scan_solidity` / `contracts.run_foundry_poc` in the frozen classification table are target IDs, not current `build_catalog()` entries.
- The frozen 159-function classification and T0 assembled surfaces are historical design/baseline inputs, not the current live tool inventory.
- PE and credential skills already refer to LinPEAS, WinPEAS, pspy, and John, while the Dockerfile does not explicitly provision them.
- `snmp_recon` exists, but its subprocess invocation, timeout handling, execution placement, and success/error reporting need correction before it can support a healthy SNMP claim.
- BloodHound ingest/client code and collection instructions exist. A NetExec dependency alone does not establish collector entrypoint availability or BHCE schema compatibility.

## 3. Architecture and contract decisions

### D1 — Separate runtime availability from evidence maturity

Keep the existing `CapabilityStatus` aggregation:

- All declared implementations healthy: `AVAILABLE`.
- Some declared implementations healthy: `PARTIAL`.
- None healthy, or no implementations: `UNAVAILABLE`.

The release report separately answers **whether at least one complete path is verified**. Do not change `AVAILABLE` to mean "one implementation passed a benchmark" or silently reinterpret `PARTIAL`.

Availability checks technical executability. Eligibility checks role/phase/state requirements. Authorization checks the specific invocation. A missing credential or target session normally affects eligibility, not global executor availability; an out-of-scope target affects authorization.

Any change to public status semantics requires an ADR and re-review of the frozen contracts.

### D2 — Register complete paths, not package names

```text
CapabilityRequest
  -> declared implementation
  -> registered adapter OR bounded worker OR declared service/MCP path
  -> guarded executor in the correct environment
  -> raw artifact via ArtifactStore
  -> parser/normalizer when required
  -> typed result / observations
  -> verifier and engagement-scoped KG writes when required
```

- An adapter builds the execution specification; it does not execute or parse.
- The normalizer owns interpretation. Parse artifact content obtained through ArtifactStore, never treat `artifact_ref` as a filesystem path.
- In-process generators/renderers may return typed results without an external CLI or artifact parser; record those stages as `N/A` with a reason.
- A worker requires a registered `WorkerSpec`, explicit primitive allowlist, and required `CompletionSpec.max_steps`.
- A registered Python carrier must have an actual runtime invocation route. Import success is not enough; not every in-process carrier belongs in the CLI adapter resolver.
- Bash remains a specialist escape hatch and can be an explicitly declared worker primitive. It never implicitly satisfies capability availability.

### D3 — Distinguish executors from deployable resources

John, Nmap, NetExec, and Forge are attacker-side executors. LinPEAS, WinPEAS, pspy, and a target Ligolo agent are resources deployed to a target/session. A Linux PATH probe cannot validate a Windows resource execution path.

Before implementing resource support, propose an ADR specifying:

- Executor/resource identity, version, upstream source, license, and content digest.
- Placement: sandbox, target, or sidecar; explicit justification for control-plane execution.
- Target OS/architecture compatibility and the session mechanism used to execute it.
- Verified transfer, bounded execution/monitoring, artifact retrieval, and cleanup ownership.
- How resources are resolved without conflating input resources with output `Artifact` records.

Choose the smallest runtime design that covers real fixtures. Do not add an extensible public resource API or fields to core contracts before the ADR is reviewed. Plugins continue to depend only on SDK/core; session and sandbox dispatch remain runtime-owned.

### D4 — Keep additions optional and reproducible

New executor/resource profiles default off. Profile names/build flags below are proposals, not existing configuration. Pin package/release versions, resource digests, compiler dependencies, template corpora, and benchmark wordlists. Record image identity and the tool/adapter/parser/data version chain.

Benchmarks must not silently download or update corpora during a run. Unknown provenance makes that evidence unqualified for reproducibility claims.

### D5 — Add semantic implementations without inflating the planner surface

Adding John or LinPEAS should implement a semantic capability or declared worker workflow, not expose every upstream CLI flag as an agent tool. Expand skill availability only when a usable path exists; preserve offline analysis and source-generation workflows independently from execution capabilities.

## 4. Capability coverage matrix

TC-0 will generate a fresh report for the exact checkout, image, profile, and environment. The rows come from both the runtime catalog and product/skill claims: claims absent from the catalog are recorded as **undeclared claims**, not invented runtime manifests.

Required columns:

| Group | Fields |
|---|---|
| Identity | Advertised claim, capability ID if declared, implementation ID, owning role/plugin |
| Route | Adapter/worker/service registration, execution placement, runtime call route |
| Prerequisites | Profile, executor/resource, supported version, OS/architecture, required data corpus |
| Output | Expected format/result, parser/normalizer and version, expected observations |
| Knowledge | Skill references if needed, verifier, scoped KG write path if needed |
| Health | Probe environment, result, timestamp, bounded failure reason |
| Evidence | Fixture/run reference, checkout/image/tool/data versions, outcome, duration/cost when available |
| Release | Supported scope, current gap, owning work package, next action |

Report presence, health, controlled execution, and live benchmark evidence separately. `N/A` requires a reason; `not run` is not `pass`. A parser, skill, or KG write is only mandatory when the declared capability needs it.

Readiness means at least one **complete declared path** is verified for that advertised scope and deployment profile. It is a reporting/release rule, not a new `CapabilityStatus` enum member.

## 5. Delivery sequence

`TC-*` identifiers below are follow-up work packages, not the tool-optimization waves T0–T13 or Incalmo benchmark tiers. All packages are proposed. Respect existing wave approval before changing their contracts or runtime behavior.

| Package | Priority | Deliverable | Dependencies |
|---|---|---|---|
| TC-0 | P0 | Current coverage matrix and claim inventory | None |
| TC-1 | P0 | Existing binary paths produce normalized output | TC-0 |
| TC-2 | P0 | Placement-aware health and guarded invocation wiring | TC-0; validate completed paths from TC-1 |
| TC-3 | P0 | Reproducible binaries, resources, corpora, and provenance | TC-0 |
| TC-4 | P1 | Linux PE resources; Windows resources when in scope | TC-2/3; resource ADR |
| TC-5 | P1 | John-based offline credential path | TC-2/3 |
| TC-6 | P1 audit | BloodHound collector-to-ingest verification | TC-0/2/3; add collector only if absent/incompatible |
| TC-7 | P2 | Correct sandbox-backed SNMP path | TC-2/3 |
| TC-8 | Conditional | Contracts/fuzz/domain execution profiles | TC-0/2/3; workload and product-scope decision |
| TC-9 | Release gate | Controlled execution and live mission evidence | Every package included in the release scope |

TC-3 and the TC-6 inventory can proceed alongside existing-chain repairs. Prioritize TC-4/5 over optional ecosystem expansion once the shared execution/provenance foundation is verified.

TC-1's parser deliverables can land before TC-2. Full-chain acceptance for both packages requires the runtime wiring and controlled execution checks; parser-only completion does not close TC-1.

Each package is split into one-concern PRs: ≤400 runtime lines and ≤10 files unless an explicit exception is approved through the repo's procedure. A package is not permission for a single cross-stack mega-PR. New dependencies, subsystem boundaries, or public API changes need a proposed ADR before code lands.

## 6. Work packages

### TC-0 — Inventory claims and generate coverage evidence

**Objective:** Establish the baseline that drives every addition.

**Work:**

1. Inventory current catalog, adapter/worker/service registrations, parser formats, loaded plugins, assembled role surfaces, skill workflows, and advertised documentation claims.
2. Inspect actual built images and enabled profiles; separate transitive package presence from explicitly supported execution paths.
3. Record current runtime call routes, including Python carriers, direct specialist tools, and sandbox/sidecar transport boundaries.
4. Emit the matrix in §4 to a new run/evaluation output location, never over the frozen T0 files.
5. Mark claims as offline analysis, source generation, execution, or verified outcome. Narrow or profile-gate unsupported execution claims without disabling valid offline tools.

**Likely edit scope:** A narrow inventory/report utility and focused tests; catalog/adapter/parser registries are inputs. Do not refactor those subsystems for the inventory.

**Acceptance:** All 21 baseline manifests are accounted for, the missing formats in §2.1 are visible, and undeclared product/skill execution claims are listed. A fresh snapshot has checkout/image/profile provenance and does not mutate the T0 baseline.

### TC-1 — Complete existing adapter-to-observation paths

**Objective:** Close the highest-confidence gaps before installing new tools.

**Work:**

1. Complete `sqlmap_log`, `nikto_txt`, `impacket_txt`, and `responder_log` normalization, one output family per PR. Prefer stable machine-readable output where supported; version any adapter/format change and preserve importer compatibility.
2. For Impacket, distinguish lateral execution, credential extraction, failures, and emitted files. Shared format names must not create ambiguous interpretation.
3. Confirm metadata needed to anchor findings to the target/engagement is preserved without inferring it from unrelated content.
4. Exercise request resolution, guarded execution, artifact storage/retrieval, parser resolution, verification, and scoped KG writes. Treat adapter construction alone as an intermediate milestone.
5. If optional auto-ingest is extended, add only verified allowlisted paths under L2a/L2b. Bound hook time/output, contain failures, and prove the original tool result is returned unchanged; the KG remains the canonical state store.

**Likely edit scope:** `execution/adapters/{web,ad}/`, `knowledge/ingest/parsers/`, parser registration/materialization, and narrow integration fixtures. Hook wiring is a separate concern.

**Acceptance:** Each included adapter's expected formats resolve; real versioned output yields expected typed results/observations. Empty findings, malformed/truncated output, authentication errors, permission failures, and partial executions do not become fabricated success. Existing Nmap/Subfinder/Gobuster paths still pass.

### TC-2 — Probe and invoke in the actual execution environment

**Objective:** Replace import/PATH optimism with environment-specific execution evidence.

**Work:**

1. Use the evaluator's existing injectable probe seam to check the actual sandbox/sidecar or resource inventory. Resolve worker IDs against the real worker registry.
2. Add bounded presence/version/health checks and registration/output-contract checks. Startup probes do not scan targets or require live credentials.
3. Wire each supported route through existing authorization and sandbox/session dispatch. Verify `implementation_id` survives into execution/artifact provenance.
4. Correct any Python carrier that imports but has no usable invocation route; do not invent a bash fallback or force renderers into a CLI-only resolver.
5. Record profile-disabled, missing binary, incompatible version, unreachable sidecar, unsupported resource architecture, and missing parser as distinct report failures.
6. Make health refresh bounded and environment-keyed so a restarted/rebuilt container does not inherit stale results.
7. For existing web/AD/pivot profiles, declare and wire the selected semantic paths rather than treating installation as support. Add profile-backed implementations such as Nuclei, NetExec, or Certipy only for the capabilities in the approved scope, with real output/format compatibility fixtures. Do not require every installed utility to become a separate capability.

**Likely edit scope:** `execution/capabilities/availability.py`, resolver and runtime dispatch seams, worker/service wiring, and focused health tests. Split by execution placement.

**Acceptance:** A binary present only on the host cannot qualify a sandbox path; an enabled build flag alone cannot qualify an absent package. Missing routes/formats are reported before claiming a complete path. Eligibility/authorization remain separate, and a valid path executes through the normal guardrails.

### TC-3 — Pin inputs and attach execution provenance

**Objective:** Make before/after measurements reproducible.

**Work:**

1. Select a repeatable package-source/version strategy for Kali profiles; the base-image digest alone does not pin packages installed later from rolling repositories.
2. Pin Nuclei binary and templates; pin benchmark wordlists, resource releases, and any compiler/dependency corpus required by a selected workflow.
3. Resolve profile version manifests into execution provenance, not merely files in the image. Record unknown versions explicitly as evidence gaps.
4. Store checkout and image identity, adapter/parser/data versions, and fixture identity alongside run evidence.
5. Keep benchmark execution free from silent corpus updates and unrelated network-dependent setup.

**Likely edit scope:** `infra/containers/`, Compose build arguments, `execution/capabilities/provenance.py`, adapter/executor metadata, and reproducibility checks. Separate binary packaging from provenance wiring PRs.

**Acceptance:** Repeating a fixture with the same recorded environment uses the same relevant tool/data inputs. A changed template/wordlist/resource digest is visible. Missing provenance cannot produce a benchmark-ready claim.

### TC-4 — Provision PE resources and a bounded target execution path

**Objective:** Close local-enumeration gaps after an initial foothold.

**Proposed resource bundle:** LinPEAS and pspy for Linux; WinPEAS when Windows fixtures are included. These are target-side resources, not Linux sandbox executables.

**Work:**

1. Review D3's resource/session ADR; select pinned releases and supported OS/architecture variants.
2. Implement resource resolution and digest verification, transfer through supported target-session mechanisms, execution, retrieval, and cleanup tracking.
3. Bound LinPEAS/WinPEAS enumeration and pspy observation time/output. Ensure cancellation stops monitoring and records its terminal state.
4. Normalize only evidence supported by output. Enumeration suggestions are hypotheses; a resource finding is not proof of successful privilege escalation.
5. Connect existing PE skills to the declared path instead of relying on ad-hoc downloads. Any expanded tool permission is explicitly reviewed.

**Likely edit scope:** Resource packaging, runtime-owned session/resource support, parser/normalizer, catalog/worker declarations, and the existing PE skill workflows; split these concerns.

**Acceptance:** Versioned resources execute through a real test session, transfer/architecture errors surface, monitoring terminates at its bound, evidence returns to the correct engagement, and cleanup outcome is recorded. The fixture verifies enumeration against known facts; actual escalation is a separate capability/benchmark.

### TC-5 — Add John and verify an offline credential workflow

**Objective:** Match existing hash-producing workflows and skill instructions with an offline executor.

**Proposed profile:** `sandbox-credentials`; an opt-in build flag such as `INSTALL_CREDENTIAL_TOOLS` is introduced only with the implementation.

**Work:**

1. Install a pinned John build whose supported formats match the selected workloads. Check required converters as well as the main executable.
2. Provide a pinned benchmark dictionary and explicit input format selection; do not assume `rockyou.txt` exists.
3. Declare a typed adapter or bounded worker route with resource budgets, cancellation, output capture, and normalization.
4. Verify format support and synthetic known-result fixtures for the initial supported formats, including an AD-derived format if advertised.
5. Separate no-match, unsupported format, timeout, and executor failure. Define controlled artifact/state handling for credential-bearing results and test the redaction boundary; telemetry records metadata only.

**Acceptance:** A synthetic known password is recovered and independently verified; no-match/timeout/unsupported cases are distinguished, and absent profiles cannot claim execution support. Hashcat is deferred unless workload measurements justify another backend; GPU absence alone is not the decision rule.

### TC-6 — Verify BloodHound collection before adding another collector

**Objective:** Establish one compatible collection-to-ingest path.

**Work:**

1. Inspect the built AD profile for the actual collector distribution, entrypoint, version, and CE/legacy output compatibility. Do not infer these from NetExec dependencies.
2. Declare the collector explicitly if the advertised workflow requires it and it is absent or incompatible.
3. Run collection against a controlled AD fixture, ingest the archive through the intended BHCE/KG route, and query expected objects/relationships.
4. Preserve collection-method and partial-collection provenance. Test unavailable collection methods and ingest/schema failures.

**Likely edit scope:** AD profile packaging, runtime collector adapter/session path, existing BloodHound/BHCE clients and ingest, and controlled AD fixtures.

**Acceptance:** Collector -> output archive -> ingest -> expected query results is proven for the supported versions. Add SharpHound only if this path is missing or measured fidelity is insufficient, using the resource mechanism for target-side execution.

### TC-7 — Finish sandbox-backed SNMP enumeration

**Objective:** Add appliance/network coverage without a second overlapping SMB stack.

**Proposed profile:** `sandbox-network-extra`, providing the required Net-SNMP utilities.

**Work:**

1. Correct subprocess/timeout/success semantics in the existing SNMP path and route execution through the guarded sandbox executor, not an unscoped agent-host subprocess.
2. Handle target port and SNMP version correctly. Support typed SNMPv3 security parameters only if that version is advertised; a community-string interface is insufficient for v3.
3. Bound walks by time/output and normalize system/interface evidence from a controlled SNMP service.
4. Test missing utility, unsupported version, failed authentication, unreachable service, and timeout without reporting success.

**Acceptance:** Supported versions work through the sandbox against known data; errors are explicit and target/scope enforcement remains intact. `enum4linux-ng` is deferred unless a fixture exposes a specific gap beyond NetExec/Impacket/smbclient.

### TC-8 — Conditional domain executor profiles

These packages require a scope decision at TC-0. Full execution claims must be implemented or narrowed; valid offline analysis/source generation remains supported independently.

| Package | Add when | Proposed contents | Required execution evidence |
|---|---|---|---|
| TC-8a contracts | Slither analysis or executed Foundry PoCs are product commitments | Slither, compatible pinned Solidity compiler management, Foundry/Forge, pinned project dependencies such as `forge-std` | Known contract -> analysis; generated test -> compile/run -> independently interpreted outcome |
| TC-8b fuzz | Running fuzz campaigns is advertised | One engine first; C/C++ libFuzzer requires a matching Clang/sanitizer toolchain, or AFL++ with a proven compatible harness/driver | Compile -> bounded campaign -> known crash artifact -> replay -> normalized evidence |
| TC-8c mobile | Static APK source analysis is in scope | jadx alongside existing adb/apktool | Controlled APK -> decompilation -> expected findings; emulator/device path verified when needed |
| TC-8d cloud/container | Live/container scanning extends supplied-config offline analysis | Trivy plus pinned relevant data; specific cloud CLI only for a selected workload | Controlled image/config/cluster fixture -> expected verified findings |
| TC-8e DFIR | Memory/disk/timeline workflows are product commitments | Separate DFIR profile; select Volatility, Plaso, or disk/network tooling by artifact type | Known forensic artifact -> supported plugin/parser -> expected evidence and timeline |

Each row is separate work, not one domain mega-profile. For fuzzing, distinguish harness generation from campaign execution; validate engine compatibility before declaring support. For contracts, validate generated-test semantics rather than treating any Forge exit code as proof of a vulnerability.

**Deferred unless evidence changes priority:** Metasploit (optional framework profile only), Chisel, Hashcat, SharpHound, duplicate web scanners, Frida/Objection, and broad cloud/DFIR ecosystems. Current SSH/Ligolo paths must be verified before claiming pivot coverage; adding another tunnel is not their verification.

### TC-9 — Execute benchmarks and reconcile advertised support

**Objective:** Turn mechanism checks into attributable capability evidence.

**Work:**

1. Run the controlled execution fixtures in §7 on built images through the actual runtime routes.
2. Run a small core mission set through planner/worker/executor/KG with CLI or harness capture. Cover web/network discovery, Linux PE enumeration, credential processing, and scoped multi-host/AD paths as available.
3. Join model/tool/task records with implementation, artifacts, observations, and outcome. Missing attribution is a capture gap, not a success to estimate.
4. Compare paired baseline/candidate runs on the development corpus with fixed target/data versions, equivalent hints, and recorded model settings.
5. Publish the coverage matrix and reconcile documentation/skills with verified scope. Report disabled profiles, unrun domains, and pending live evaluation explicitly.

**Acceptance:** Every release claim has evidence matching its advertised scope. Live results are labeled separately from scripted selection, replay, and canned-artifact checks. Held-out scenarios are evaluated only after decisions/thresholds freeze and never used to tune schemas.

## 7. Verification and benchmark strategy

### Evidence levels

| Level | What it proves | What it does not prove |
|---|---|---|
| Inventory/registration | Manifest, route, binary/resource and parser declarations exist | Health or successful execution |
| Unit/parser mechanism | Validation and normalization handle genuine versioned fixtures | Deployed image correctness |
| Record/replay | Captured behavior can be replayed; hooks preserve results on failure | A new binary works or a model makes good decisions |
| Controlled execution | Actual built executor/resource -> artifacts -> verified result/observations | Live planner/worker mission performance |
| Live mission | Full planner/worker/execution/state path on a controlled target | Generalization beyond the evaluated workloads |

### Minimum controlled fixtures

- Existing adapters: target known positive/negative behavior; verify real output formats, parser results, and scoped writes. Retain Nmap/Subfinder/Gobuster as controls.
- PE: seeded local-enumeration facts and a timed process observation, plus incompatible resource/session and cancellation cases.
- Credentials: synthetic supported hashes with a tiny pinned dictionary; known match, no match, unsupported format, timeout, and cancellation.
- AD collector: known users/groups/relationships; collection archive, intended ingest route, and schema/partial-collection checks.
- SNMP: controlled system/interface data, selected versions/ports, authentication failure, and bounded unreachable/timeout cases.
- Conditional domains: known contract findings/PoCs, a replayable fuzz crash, a controlled APK, or known cloud/forensic artifacts as applicable.

For each implemented route, exercise the absent/disabled configuration as well as the enabled path. Guardrail checks include out-of-scope rejection, invalid parameters, and engagement isolation. New/changed regression tests must be observed failing before the fix passes, per contributor rules.

### Capture and reproducibility

- Use a fresh thread and engagement workspace per run; verify the engagement-specific `/workspace` mounts according to ADR-0042.
- Use scoped fresh-KG setup where required, with reset failure aborting pre-flight; never reset the read-only Skillogy corpus or unrelated engagements.
- Capture `record.jsonl` in the runtime executing the agent, `events.jsonl`, RoE audit, exact inputs/protocol, artifacts, state snapshots, bounded logs, and manifest/summary.
- Harness model/tool logs derived from thread message diffs are labeled as derived; do not present them as complete in-process middleware traces.
- Correlate parent task/child execution and tool/skill allocation evidence where supported. A role label alone is not guaranteed to reconstruct every concurrent child; add narrowly scoped attribution only if the selected analysis requires it.
- Run manifests include enabled profiles, binary/resource/data versions, model/provider settings, worker budgets, and hint protocol. Metrics/provenance never log or tune on raw parameter values, credentials, hashes, tokens, or keys.
- Use new report paths under runtime/benchmark output directories. Never overwrite frozen baseline JSONL or tune on held-out data.

### Checks per implementation PR

Benchmark reports include denominators and workload scope for verified-path coverage, expected-observation accuracy, parser/executor failure rate, live task success, unnecessary tool calls, and implicit-bash-fallback incidents. Report latency, step count, and cost when measured; missing usage is unknown, not zero. Compare only equivalent fixtures/profiles/model settings, and distinguish scripted selection metrics from live decisions.

Run focused parser/adapter/registry/profile tests, then `make ci-lint` and `make ci-test` in the supported environment. Cross-stack changes require the matching live smoke lane and actual Compose build/start/health verification. Skill changes require `make audit-skills-strict` and `make check-skill-graph`; relevant POSIX-only tests run on Linux/WSL. Record exact commands and observed happy/failure behavior in the PR evidence.

## 8. Release acceptance criteria

A core-tool completion release is ready only when:

1. The scope is explicit, and every advertised execution claim in that scope maps to a declared route or is honestly narrowed/profile-gated.
2. At least one complete path per included capability is verified in its declared environment. Presence/import checks and canned artifacts do not satisfy this criterion.
3. Required parsers/results/verifiers and engagement-scoped state writes are wired; missing output formats cannot qualify a path.
4. Linux PE resource execution and John workflows pass if included in core scope; Windows support passes its own resource/session fixture before being advertised.
5. BloodHound collection and SNMP are verified if advertised; conditional contracts/fuzz/domain execution has matching evidence or remains outside the execution claim.
6. Benchmarked binary/resource/template/wordlist/compiler inputs and image identity are recorded and reproducible.
7. Disabled/missing/incompatible paths, execution errors, partial outputs, and cancellation are represented correctly. No implicit bash fallback or fabricated success exists.
8. Isolation, RoE, egress, HITL, budgets, recovery exposure, and fail-safe post-tool hooks retain their guarantees.
9. The coverage report separates technical availability, evidence maturity, eligibility, and authorization; live benchmark gaps remain visible.
10. PR scope/ADR requirements and the relevant lint/test/smoke/skill lanes are satisfied on the exact delivered tree.

Optional domains do not block a core-only release when their support claims are explicitly restricted. A generator/offline scanner need not be removed merely because its separate execution stage is unavailable.

## 9. Risks and open decisions

| Decision/risk | Required resolution |
|---|---|
| Existing wave status differs between plan text and code presence | Confirm wave approvals before starting dependent implementation; do not infer sign-off from comments or filenames |
| Resource/session API crosses a new boundary | Review D3 ADR; use SDK/core contracts for plugins and keep execution runtime-owned |
| Rolling package/template updates change results | Select source/version/digest strategy at TC-3; reject unqualified reproducibility claims |
| No controlled Windows/AD environment | Keep those paths unverified; provide a fixture before release claims |
| Parser output implies more than the tool established | Separate evidence, hypothesis, and independently verified outcome |
| Optional tools add overlapping surface and image weight | Require a named capability/workload gap; evaluate runtime cost before adding |
| Corpus/tool-specific licensing or redistribution restrictions | Select redistributable pinned resources or document operator provisioning; do not bundle an unreviewed corpus |

Decide at TC-0: the first supported credential formats, Linux/Windows architectures, collector distribution/schema, SNMP versions, first fuzz engine, required domain execution claims, and representative live missions. Freeze quantitative benchmark thresholds before held-out evaluation.

## 10. Implementation checklist

- [ ] Confirm existing initiative/wave approvals and core product scope.
- [x] TC-0: publish fresh claim/implementation/environment coverage matrix.
- [x] TC-1: close each selected missing parser format and execute the full chain.
- [x] TC-2: verify placement-aware probes, registered routes, and guarded invocation.
  (Done: `PlacementHealthChecker` in `execution/capabilities/health.py` —
  bounded in-sandbox probes, distinct failure taxonomy, environment-keyed
  TTL cache, profile gating, route/parser contract checks; catalog gained
  the `web.scan_templates` (nuclei) capability and the
  `access.move_laterally.netexec` second implementation.)
- [x] TC-3: pin runtime/benchmark inputs and attach real version provenance.
  (Done: `execution/capabilities/tool_versions.py` parses the
  `/opt/raptix/tool-versions/*.tsv` manifests into provenance with
  explicit unknown-gaps; the web profile now REFUSES to build without
  `NUCLEI_TEMPLATES_VERSION` and records the pinned corpus.)
- [x] Review resource/session ADR before changing public contracts or adding the boundary.
  (Done: ADR-0043 `docs/adr/0043-target-side-resource-execution.md`,
  Status: Proposed — packaging half shipped, transfer/execution half gated.)
- [x] TC-4: verify Linux resources; include Windows only with matching fixtures.
  (Packaging + parsers DONE: ADR-0043 accepted; pinned manifest
  `infra/resources/target-linux.json` with digests verified by
  download+sha256 on 2026-10-07 (pspy v1.2.1, LinPEAS
  20261006-4cf2d06d); `peas_txt` / `pspy_log` T3 parsers registered.
  The target-side transfer/execution path still requires a separate
  reviewed PR per the ADR gate.)
- [x] TC-5: verify John format coverage, dictionary provenance, and bounded execution.
  (Done AND LIVE-VERIFIED: the tc-live sandbox image cracked md5
  ("password") with the repo-pinned dictionary; pot file produced the
  deterministic `...:password` artifact the `john_pot` parser reads.)
- [ ] TC-6: verify collector -> archive -> ingest -> expected relationships.
  (Deferred: needs a built AD profile image + controlled AD fixture.)
- [x] TC-7: complete SNMP execution and error/timeout handling if in scope.
  (Done: `network.snmp_enumerate` capability + `network.snmpwalk` adapter
  with typed v3 USM params + `snmpwalk_txt` parser +
  `sandbox-network-extra` profile; the legacy `snmp_recon` tool (and its
  sibling recon tools) had mechanically broken subprocess timeouts — all
  fixed to `asyncio.wait_for` with honest success semantics.)
- [ ] TC-8: approve and implement selected domain profiles as separate concerns.
  (Scope APPROVED 2026-10-07. DONE: `sandbox-contracts` profile with
  pip-pinned slither 0.11.6 + `contracts.audit_static` capability +
  `contracts.slither` adapter + `slither_json` parser; image verified
  live (slither 0.11.6). DEFERRED within TC-8: forge test execution
  (foundryup pin + `forge test` adapter) and an afl++ fuzz profile —
  each is its own concern/PR.)
- [ ] TC-9: run controlled execution and live mission comparisons with full capture.
  (Controlled execution DONE for the tc-live image: all six
  tool-versions manifests present with real versions, nuclei template
  corpus pinned at v10.5.0, john live crack verified, netexec 1.5.1 +
  bloodhound.py 1.9.0 confirmed in-image. The BloodHound
  collection→ingest chain and live mission comparisons still need a
  controlled AD fixture (Samba DC) and the LLM proxy.)
- [ ] Reconcile advertised support and publish evidence gaps before release.
  (Partially: `undeclared_claims()` now also covers the TC-2/5/7
  additions; claims list is the reconciliation surface.)

## 11. Source references

- [Tool-optimization implementation plan](../tool-optimization-implementation-plan.md): canonical waves, WHAT/HOW separation, availability/eligibility/authorization, and bash honesty.
- [Frozen tool classification](../architecture/tool-classification.md): historical inventory and target capability IDs.
- [Incalmo safe-subset guide](../incalmo-lessons-implementation-guide.md): parser/auto-ingest boundaries and replay checks.
- [Observability capture plan](2026-10-07-observability-capture-fix-plan.md) and [run-isolation plan](2026-10-07-run-isolation-reproducibility-plan.md): capture and deployment prerequisites.
- [ADR-0042](../adr/0042-enforce-mounted-engagement-workspace.md): engagement mount isolation contract; ADR status remains as recorded in that file.
- `packages/raptix-core/raptix_core/types/capability.py`: frozen public contracts.
- `packages/raptix/raptix/execution/capabilities/{catalog,availability,registry,provenance}.py`: runtime declarations, probes, status aggregation, and version metadata.
- `packages/raptix/raptix/execution/adapters/` and `packages/raptix/raptix/execution/workers/`: typed adapters, resolution, bounded workers.
- `packages/raptix/raptix/knowledge/ingest/registry.py`, `packages/raptix/raptix/knowledge/ingest/parsers/`, and `packages/raptix/raptix/middleware/kg_autoingest.py`: parser registration and bounded optional ingestion.
- `infra/containers/sandbox.Dockerfile`, `docker-compose.yml`: binary/profile packaging and deployment wiring.
- `plugins/contracts/raptix_contracts/{tools,foundry}.py` and `packages/raptix/raptix/execution/tools/research/fuzz.py`: offline/generation semantics.
- `packages/raptix/raptix/execution/tools/network/protocols.py`, `packages/raptix/raptix/execution/tools/ad/{bloodhound,bhce_client}.py`: SNMP and BloodHound paths.
- `packages/raptix/tests/unit/{adapters,capabilities,execution}/`: existing deterministic tests, including `test_sandbox_tool_profiles.py`.
- `benchmarks/tool_eval/evaluate.py`: scripted/canned/live evaluation boundaries; `tests/local/harnesses/lab_run.py`: isolated run capture.
