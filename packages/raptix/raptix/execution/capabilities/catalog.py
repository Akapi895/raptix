"""Capability catalog (Waves T6 + T7).

The catalog is the runtime instantiation of the frozen T2 contracts
(``raptix_core.types.capability``): it maps every resolvable capability
to the implementations that can actually run it today.

Two manifest families:

* **T6 — the twelve T1-classified semantic capabilities**, currently
  in-process deterministic Python callables. Those are declared as
  ``ADAPTER`` implementations whose ``executable`` is a
  ``"module:attr"`` carrier path (e.g.
  ``"raptix.execution.tools.web.search:web_search"``) — the
  availability evaluator's import probe checks the carrier is
  importable and the attribute exists. Graduating a carrier to a real
  adapter changes the manifest entry, never the capability id.
* **T7 — the binary-backed capabilities** for the security tools
  already installed in the sandbox base image (nmap, subfinder, sqlmap,
  gobuster, nikto, python3-impacket, responder). Each declares one
  ``ADAPTER`` implementation with the bare binary name (PATH probe),
  ``profile="base"``, and an ``adapter_id`` matching a
  :mod:`raptix.execution.adapters` class. T8 adds profiles for
  binaries the base image does not ship yet.
* **T10 — the bounded-worker capability** (``exploit.unknown_service``,
  the plan's T10 example). No ``ADAPTER`` implementation: its single
  ``WORKER`` implementation resolves ``worker_id`` only through T10's
  :class:`raptix.execution.workers.WorkerRegistry`, so the capability
  aggregates UNAVAILABLE until an ``exploit_worker`` ``WorkerSpec``
  with an explicit primitive allowlist is registered — honest by
  design, never an unscoped toolset.

Deliberately NOT in the catalog:

* ``kg_surface_inventory`` — its T1 note routes it to the T4
  PlanningContext abstraction, which already absorbed it.
* Worker-primitive tools (``bin_strings``, ``kg_record``, ...) — they
  are HOW-steps of a capability's declared implementation, not
  capabilities themselves.
* Control-plane tools (``ask_user``, ``task``, ``bounty_scope_check``)
  — plan/engagement state and dispatch, not resolvable capabilities.

``allowed_roles`` uses runtime role ids; ``()`` means UNRESTRICTED
(matching ``PluginBundle.roles`` and the frozen T2 convention).
``phase_affinity`` is soft ranking only; ``allowed_phases`` is left
``None`` everywhere (the hard constraint is used sparingly).
"""

from __future__ import annotations

from raptix_core.types.capability import (
    CapabilityId,
    CapabilityManifest,
    CompletionSpec,
    ImplementationKind,
    ImplementationSpec,
    RequirementKind,
    RequirementSpec,
    RiskClass,
    RoleId,
)


def _builtin(impl_id: str, carrier: str, *, adapter_id: str | None = None) -> ImplementationSpec:
    """An in-process deterministic carrier declared as an ADAPTER impl.

    ``carrier`` is the ``"module:attr"`` path the availability probe
    imports. ``adapter_id`` names the future T7 adapter that will own
    the execution path once the carrier graduates to a real adapter.
    """
    return ImplementationSpec(
        id=impl_id,
        kind=ImplementationKind.ADAPTER,
        adapter_id=adapter_id or f"builtin.{impl_id}",
        executable=carrier,
    )


def _binary(impl_id: str, adapter_id: str, executable: str) -> ImplementationSpec:
    """A T7 binary-backed ADAPTER implementation (sandbox base profile)."""
    return ImplementationSpec(
        id=impl_id,
        kind=ImplementationKind.ADAPTER,
        adapter_id=adapter_id,
        executable=executable,
        profile="base",
    )


def build_catalog() -> tuple[CapabilityManifest, ...]:
    """Return the initial catalog: one manifest per T1 semantic capability."""
    return (
        CapabilityManifest(
            id=CapabilityId("defense.scan_coverage"),
            schema_version=1,
            description=(
                "Run the offensive-vaccine detection loop: replay attacker "
                "activity through the tap + rule matcher and record every hit."
            ),
            phase_affinity=("action_on_objectives",),
            allowed_roles=(RoleId("blue_cell"),),
            implementations=(
                _builtin(
                    "blue_cell_scan",
                    "raptix.execution.tools.defense.blue_cell:blue_cell_scan",
                ),
            ),
            outputs=("defense.detection_hit",),
            risk_class=RiskClass.MEDIUM,
            parallel_safe=False,
        ),
        CapabilityManifest(
            id=CapabilityId("defense.generate_brief"),
            schema_version=1,
            description=(
                "Render the purple-team engagement brief (attack→detection "
                "coverage summary) from the knowledge graph."
            ),
            phase_affinity=("action_on_objectives",),
            allowed_roles=(RoleId("blue_cell"),),
            implementations=(
                _builtin(
                    "defense_brief",
                    "raptix.execution.tools.defense.brief:defense_brief",
                ),
            ),
            outputs=("defense.brief_markdown",),
        ),
        CapabilityManifest(
            id=CapabilityId("defense.export_navigator"),
            schema_version=1,
            description=(
                "Export detected-technique coverage as a MITRE ATT&CK Navigator layer JSON file."
            ),
            phase_affinity=("action_on_objectives",),
            allowed_roles=(RoleId("blue_cell"),),
            implementations=(
                _builtin(
                    "export_attack_navigator",
                    "raptix.execution.tools.defense.brief:export_attack_navigator",
                ),
            ),
            outputs=("defense.navigator_layer",),
        ),
        CapabilityManifest(
            id=CapabilityId("osint.enrich_domain"),
            schema_version=1,
            description=(
                "Passive open-source enrichment for one domain (DNS, whois, "
                "breach/code-leak footprinting via httpx with mockable egress)."
            ),
            phase_affinity=("initial_foothold",),
            allowed_roles=(RoleId("osint_operator"),),
            implementations=(
                _builtin(
                    "osint_enrich",
                    "raptix.execution.tools.research.osint:osint_enrich",
                ),
            ),
            outputs=("osint.domain_record",),
            risk_class=RiskClass.MEDIUM,
        ),
        CapabilityManifest(
            id=CapabilityId("analyst.propose_patch"),
            schema_version=1,
            description=(
                "Propose a remediation patch (diff + rationale) for a "
                "validated vulnerability finding."
            ),
            phase_affinity=("action_on_objectives",),
            allowed_roles=(RoleId("analyst"), RoleId("patcher")),
            implementations=(
                _builtin(
                    "patch_propose",
                    "raptix.execution.tools.research.patch:patch_propose",
                ),
            ),
            outputs=("patch.diff",),
        ),
        CapabilityManifest(
            id=CapabilityId("analyst.verify_patch"),
            schema_version=1,
            description=(
                "Zero-false-positive patch verification: re-run the PoC "
                "against the patched target and expect failure."
            ),
            phase_affinity=("action_on_objectives",),
            allowed_roles=(RoleId("analyst"), RoleId("patcher")),
            implementations=(
                _builtin(
                    "patch_verify",
                    "raptix.execution.tools.research.patch:patch_verify",
                ),
            ),
            outputs=("patch.verification",),
            risk_class=RiskClass.MEDIUM,
        ),
        CapabilityManifest(
            id=CapabilityId("analyst.run_scan_shard"),
            schema_version=1,
            description=(
                "Scan one bounded shard of the target tree for vulnerability "
                "candidate hits (ranked prefilter feeding the pipeline)."
            ),
            phase_affinity=("initial_foothold", "action_on_objectives"),
            allowed_roles=(RoleId("scanner"), RoleId("analyst")),
            implementations=(
                _builtin(
                    "scan_shard",
                    "raptix.execution.tools.research.scanner_tools:scan_shard",
                ),
            ),
            outputs=("scan.candidate_hits",),
        ),
        CapabilityManifest(
            id=CapabilityId("web.scan_secrets"),
            schema_version=1,
            description=(
                "Detect hardcoded credentials and secret material in retrieved JavaScript content."
            ),
            phase_affinity=("initial_foothold",),
            allowed_roles=(RoleId("exploit"), RoleId("analyst")),
            implementations=(
                _builtin(
                    "scan_secrets",
                    "raptix.execution.tools.research.secret_scanner:scan_secrets",
                ),
            ),
            outputs=("web.secret_findings",),
        ),
        CapabilityManifest(
            id=CapabilityId("recon.detect_tech_stack"),
            schema_version=1,
            description=(
                "Fingerprint the technology stack behind a URL (frameworks, "
                "servers, client-side libraries)."
            ),
            phase_affinity=("initial_foothold",),
            allowed_roles=(RoleId("recon"),),
            implementations=(
                _builtin(
                    "detect_tech_stack",
                    "raptix.execution.tools.research.tech_detection:detect_tech_stack",
                ),
            ),
            outputs=("recon.tech_stack",),
        ),
        CapabilityManifest(
            id=CapabilityId("analyst.fuzz_target"),
            schema_version=1,
            description=(
                "Classify a fuzzing target and generate/verify a harness for "
                "the chosen engine (libFuzzer/honggfuzz/AFL-style entry)."
            ),
            phase_affinity=("action_on_objectives",),
            allowed_roles=(RoleId("analyst"),),
            implementations=(
                _builtin(
                    "fuzz_classify",
                    "raptix.execution.tools.research.tools:fuzz_classify",
                    adapter_id="builtin.fuzz_target.classify",
                ),
                _builtin(
                    "fuzz_harness",
                    "raptix.execution.tools.research.tools:fuzz_harness",
                    adapter_id="builtin.fuzz_target.harness",
                ),
            ),
            outputs=("fuzz.target_profile", "fuzz.harness"),
            risk_class=RiskClass.HIGH,
            parallel_safe=False,
        ),
        CapabilityManifest(
            id=CapabilityId("research.web_fetch"),
            schema_version=1,
            description=(
                "RoE-gated fetch of one advisory/CVE/write-up page for "
                "research (ADR-0010 open-web acquisition)."
            ),
            allowed_roles=(),
            implementations=(
                _builtin(
                    "web_fetch",
                    "raptix.execution.tools.web.search:web_fetch",
                ),
            ),
            outputs=("research.page_content",),
            risk_class=RiskClass.MEDIUM,
        ),
        CapabilityManifest(
            id=CapabilityId("research.web_search"),
            schema_version=1,
            description=(
                "Keyword search across the open web for advisories, CVEs, "
                "and write-ups (ADR-0010 open-web acquisition)."
            ),
            allowed_roles=(),
            implementations=(
                _builtin(
                    "web_search",
                    "raptix.execution.tools.web.search:web_search",
                ),
            ),
            outputs=("research.search_hits",),
            risk_class=RiskClass.MEDIUM,
        ),
        # ── T7: binary-backed capabilities (sandbox base profile) ──────
        CapabilityManifest(
            id=CapabilityId("network.scan"),
            schema_version=1,
            description=(
                "Enumerate live hosts and open service ports on a network "
                "range, writing an XML report (nmap)."
            ),
            phase_affinity=("initial_foothold",),
            allowed_roles=(RoleId("recon"), RoleId("exploit")),
            implementations=(_binary("network.scan.nmap", "network.nmap", "nmap"),),
            outputs=("nmap_xml",),
            risk_class=RiskClass.MEDIUM,
        ),
        CapabilityManifest(
            id=CapabilityId("network.discover_subdomains"),
            schema_version=1,
            description=(
                "Passive subdomain enumeration for one domain via public data sources (subfinder)."
            ),
            phase_affinity=("initial_foothold",),
            allowed_roles=(RoleId("recon"), RoleId("osint_operator")),
            implementations=(
                _binary("network.discover_subdomains.subfinder", "network.subfinder", "subfinder"),
            ),
            outputs=("subfinder",),
        ),
        CapabilityManifest(
            id=CapabilityId("web.test_injection"),
            schema_version=1,
            description=(
                "Actively probe one HTTP endpoint for SQL injection and "
                "confirm exploitable parameters (sqlmap, --batch)."
            ),
            phase_affinity=("initial_foothold",),
            allowed_roles=(RoleId("exploit"),),
            implementations=(_binary("web.test_injection.sqlmap", "web.sqlmap", "sqlmap"),),
            outputs=("sqlmap_log",),
            risk_class=RiskClass.HIGH,
            parallel_safe=False,
        ),
        CapabilityManifest(
            id=CapabilityId("web.fuzz_paths"),
            schema_version=1,
            description=(
                "Brute-force hidden directories and files on a web server "
                "with a wordlist (gobuster dir)."
            ),
            phase_affinity=("initial_foothold",),
            allowed_roles=(RoleId("recon"), RoleId("exploit"), RoleId("analyst")),
            implementations=(_binary("web.fuzz_paths.gobuster", "web.gobuster", "gobuster"),),
            outputs=("gobuster",),
        ),
        CapabilityManifest(
            id=CapabilityId("web.scan_web"),
            schema_version=1,
            description=(
                "Scan a web server for known misconfigurations, default "
                "files, and dangerous settings (nikto)."
            ),
            phase_affinity=("initial_foothold",),
            allowed_roles=(RoleId("recon"), RoleId("exploit")),
            implementations=(_binary("web.scan_web.nikto", "web.nikto", "nikto"),),
            outputs=("nikto_txt",),
            risk_class=RiskClass.MEDIUM,
        ),
        CapabilityManifest(
            id=CapabilityId("access.move_laterally"),
            schema_version=1,
            description=(
                "Execute commands on a remote Windows host over SMB/WMI/"
                "AT with recorded credentials (impacket psexec/wmiexec/"
                "atexec)."
            ),
            phase_affinity=("network_propagation",),
            allowed_roles=(RoleId("exploit"),),
            requirements=(
                RequirementSpec(
                    id="credential.available",
                    kind=RequirementKind.CREDENTIAL,
                    description="a usable credential for the target host is recorded in the AKG",
                ),
            ),
            implementations=(
                _binary("access.move_laterally.impacket", "ad.impacket.lateral", "impacket-psexec"),
            ),
            outputs=("impacket_txt",),
            risk_class=RiskClass.HIGH,
            parallel_safe=False,
        ),
        CapabilityManifest(
            id=CapabilityId("access.credential_dump"),
            schema_version=1,
            description=(
                "Extract local account secrets (SAM/NTDS/LSA) from a "
                "compromised Windows host (impacket-secretsdump)."
            ),
            phase_affinity=("network_propagation", "action_on_objectives"),
            allowed_roles=(RoleId("exploit"),),
            requirements=(
                RequirementSpec(
                    id="credential.available",
                    kind=RequirementKind.CREDENTIAL,
                    description="a usable credential for the target host is recorded in the AKG",
                ),
            ),
            implementations=(
                _binary(
                    "access.credential_dump.impacket",
                    "ad.impacket.cred_dump",
                    "impacket-secretsdump",
                ),
            ),
            outputs=("impacket_txt",),
            risk_class=RiskClass.CRITICAL,
            parallel_safe=False,
        ),
        CapabilityManifest(
            id=CapabilityId("network.capture_ntlm"),
            schema_version=1,
            description=(
                "Capture NTLM authentication attempts on a network "
                "segment; analyze mode by default, poisoning only on an "
                "explicit request parameter (responder)."
            ),
            phase_affinity=("network_propagation",),
            allowed_roles=(RoleId("recon"), RoleId("exploit")),
            implementations=(
                _binary("network.capture_ntlm.responder", "ad.responder", "responder"),
            ),
            outputs=("responder_log",),
            risk_class=RiskClass.HIGH,
            parallel_safe=False,
        ),
        # ── T10: the bounded-worker capability (the plan's example) ──
        CapabilityManifest(
            id=CapabilityId("exploit.unknown_service"),
            schema_version=1,
            description=(
                "Exploit a service whose execution path cannot be "
                "predetermined: a bounded worker attacks it through the "
                "explicit primitive allowlist of its WorkerSpec until the "
                "CompletionSpec observes success or exhausts its step "
                "budget."
            ),
            phase_affinity=("initial_foothold", "network_propagation"),
            allowed_roles=(RoleId("exploit"),),
            implementations=(
                ImplementationSpec(
                    id="exploit.unknown_service.bounded_worker",
                    kind=ImplementationKind.WORKER,
                    worker_id="exploit_worker",
                ),
            ),
            completion=CompletionSpec(
                success_observations=("authentication.success",),
                failure_conditions=(),
                max_steps=10,
            ),
            outputs=("authentication.success",),
            risk_class=RiskClass.HIGH,
            parallel_safe=False,
        ),
    )
