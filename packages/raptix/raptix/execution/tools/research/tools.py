"""Agent-facing research tools: KG CRUD internals, dependency/CVE
enrichment, and the five duplicate-analysis twins pending their
KGAutoIngestMiddleware replacement review.

The rest of the former monolithic tool surface now lives next to its own
logic module, re-exported here for ``RESEARCH_TOOLS`` assembly and for
backward-compatible ``research_tools.<name>`` access:

- ``cve_lookup`` / ``cve_by_package`` — :mod:`.cve`
- ``plan_attack_chains`` / ``suggest_objectives_from_chains`` — :mod:`.chain`
- ``fuzz_classify`` / ``fuzz_harness`` / ``fuzz_record_crash`` — :mod:`.fuzz`
- ``validate_finding`` — :mod:`.poc`
- All 14 ``kg_ingest_*`` scanner-output services — :mod:`.ingest_services`

``cve_enrich_dependencies`` (below) stays here rather than moving into
:mod:`.cve`: it needs ``graph_transaction``/``Node``/``Edge`` to write
enrichment results into the KG, and ``cve.py`` is deliberately
dependency-free so it stays reusable for synthetic/offline analysis
outside a live engagement.

Wave T4 folded the raw KG surface into internal services: the six
former ``@tool`` wrappers in this module (``kg_add_node``,
``kg_add_edge``, ``kg_query``, ``kg_neighbors``, ``kg_stats``,
``kg_backend_health``), ``kg_dedupe_findings`` (:mod:`.dedupe`), and
the five duplicate analysis twins (``kg_analyze_jwt``,
``kg_analyze_oauth_callback``, ``kg_analyze_cookie_value``,
``kg_scan_solidity``, ``kg_triage_binary``) are all plain importable
functions now. Agents read the graph through the semantic projections
(:mod:`.semantic`) and write through ``kg_record`` / auto-ingest —
never raw CRUD. The five analysis twins are demoted per the T1
classification's duplicate-merge notes: every capability they carried
is already exposed by the domain-owned tools ``jwt_parse`` /
``oauth_audit`` / ``cookie_audit`` / ``solidity_scan_file`` /
``bin_identify`` + ``bin_strings``. They are kept here, not deleted,
pending verification of whether KGAutoIngestMiddleware actually
replaces their KG-write path for these five formats.

Every tool returns a compact, JSON-serialisable string so it fits the
LangChain tool return contract and keeps LLM token usage low.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from langchain_core.tools import tool
from raptix_contracts.patterns import scan_solidity_source
from raptix_reversing.binary import identify_binary
from raptix_reversing.packer import detect_packer
from raptix_reversing.strings import extract_strings, group_by_category
from raptix_reversing.symbols import summarize_symbols
from raptix_web.jwt import parse_token
from raptix_web.oauth import analyze_oauth_callback
from raptix_web.session import analyze_cookie

from raptix.execution.tools.research import cve as cve_mod
from raptix.execution.tools.research.chain import (  # noqa: F401  # re-exported: see module docstring
    plan_attack_chains,
    suggest_objectives_from_chains,
)
from raptix.execution.tools.research.cve import (  # noqa: F401  # re-exported: see module docstring
    cve_by_package,
    cve_lookup,
)
from raptix.execution.tools.research.dedupe import (  # noqa: F401  # re-exported: plain service stays importable via tools
    kg_dedupe_findings,
)
from raptix.execution.tools.research.fuzz import (  # noqa: F401  # re-exported: see module docstring
    fuzz_classify,
    fuzz_harness,
    fuzz_record_crash,
)
from raptix.execution.tools.research.health import backend_health
from raptix.execution.tools.research.ingest_services import (  # noqa: F401  # re-exported: see module docstring
    kg_ingest_asrep_hashes,
    kg_ingest_crackmapexec,
    kg_ingest_dnsx,
    kg_ingest_ffuf,
    kg_ingest_gobuster,
    kg_ingest_httpx_jsonl,
    kg_ingest_katana,
    kg_ingest_masscan,
    kg_ingest_nmap_xml,
    kg_ingest_nuclei_jsonl,
    kg_ingest_sarif,
    kg_ingest_slither,
    kg_ingest_subfinder,
    kg_ingest_testssl,
)
from raptix.execution.tools.research.osint import OSINT_TOOLS
from raptix.execution.tools.research.patch import PATCH_TOOLS
from raptix.execution.tools.research.poc import (  # noqa: F401  # re-exported: see module docstring
    validate_finding,
)
from raptix.execution.tools.research.scanner_tools import SCANNER_TOOLS
from raptix.execution.tools.research.secret_scanner import scan_secrets
from raptix.execution.tools.research.semantic import (
    find_attack_paths,
    inspect_asset,
    search_knowledge,
)
from raptix.execution.tools.research.tech_detection import detect_tech_stack
from raptix.knowledge.ingest.parsers import severity_from_string as _severity_from_string
from raptix_core.types.kg import (
    SEVERITY_SCORE,
    Edge,
    EdgeKind,
    Node,
    NodeKind,
    Severity,
)
from raptix_core.utils.logging import get_logger

log = get_logger("research.tools")


# ── Helpers ─────────────────────────────────────────────────────────────
#
# ``_load`` / ``_save`` / ``_json`` are compatibility wrappers in
# ``_state.py`` that route through the Neo4j store. All 40+ call sites
# in this file use them unchanged.
from raptix.execution.tools.research._state import (  # noqa: E402
    _json,
    _kg_backend_name,
    graph_transaction,
    kg_degrades,
)


def _parse_props(props_json: str) -> dict[str, Any]:
    if not props_json:
        return {}
    try:
        parsed = json.loads(props_json)
    except json.JSONDecodeError as e:
        raise ValueError(f"props must be valid JSON: {e}") from None
    if not isinstance(parsed, dict):
        raise ValueError("props must be a JSON object")
    return parsed


def _severity_from_score(score: float) -> Severity:
    if score >= 9.0:
        return Severity.CRITICAL
    if score >= 7.0:
        return Severity.HIGH
    if score >= 4.0:
        return Severity.MEDIUM
    if score > 0.0:
        return Severity.LOW
    return Severity.INFO


def _severity_threshold(sev: Severity) -> float:
    return SEVERITY_SCORE.get(sev, 0.0)


def _jwt_finding_severity(finding: str) -> Severity:
    text = finding.lower()
    if "alg=none" in text:
        return Severity.CRITICAL
    if "key confusion" in text or "path traversal" in text:
        return Severity.HIGH
    if "no exp" in text or "expired" in text:
        return Severity.MEDIUM
    return Severity.LOW


def _cookie_finding_severity(finding: str) -> Severity:
    text = finding.lower()
    if "predictable session" in text:
        return Severity.HIGH
    if "httponly not set" in text or "samesite" in text:
        return Severity.MEDIUM
    if "secure flag not set" in text:
        return Severity.MEDIUM
    return Severity.LOW


def _iter_requirements(path: Path) -> list[tuple[str, str, str]]:
    deps: list[tuple[str, str, str]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        line = line.split(";", 1)[0].strip()
        line = line.split("#", 1)[0].strip()
        m = re.match(r"([A-Za-z0-9_.\-]+)\s*==\s*([A-Za-z0-9_.\-+]+)$", line)
        if m:
            deps.append((m.group(1), m.group(2), "PyPI"))
    return deps


def _iter_package_lock(path: Path) -> list[tuple[str, str, str]]:
    deps: list[tuple[str, str, str]] = []
    payload = json.loads(path.read_text(encoding="utf-8"))

    packages = payload.get("packages")
    if isinstance(packages, dict):
        for pkg_path, meta in packages.items():
            if not pkg_path.startswith("node_modules/"):
                continue
            if not isinstance(meta, dict):
                continue
            name = meta.get("name") or pkg_path.rsplit("node_modules/", 1)[-1]
            version = meta.get("version")
            if isinstance(name, str) and isinstance(version, str):
                deps.append((name, version, "npm"))
        return deps

    # npm lockfile v1 fallback
    stack = [payload.get("dependencies", {})]
    while stack:
        cur = stack.pop()
        if not isinstance(cur, dict):
            continue
        for name, meta in cur.items():
            if not isinstance(meta, dict):
                continue
            version = meta.get("version")
            if isinstance(name, str) and isinstance(version, str):
                deps.append((name, version, "npm"))
            nested = meta.get("dependencies")
            if isinstance(nested, dict):
                stack.append(nested)
    return deps


def _iter_go_sum(path: Path) -> list[tuple[str, str, str]]:
    deps: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        module = parts[0]
        version = parts[1]
        if module.endswith("/go.mod"):
            module = module[: -len("/go.mod")]
        if version.endswith("/go.mod"):
            version = version[: -len("/go.mod")]
        key = (module, version)
        if key in seen:
            continue
        seen.add(key)
        deps.append((module, version, "Go"))
    return deps


def _iter_cargo_lock(path: Path) -> list[tuple[str, str, str]]:
    deps: list[tuple[str, str, str]] = []
    # Cargo.lock is TOML-like; avoid external deps with a tiny parser.
    current_name: str | None = None
    current_ver: str | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line == "[[package]]":
            if current_name and current_ver:
                deps.append((current_name, current_ver, "crates.io"))
            current_name = None
            current_ver = None
            continue
        if line.startswith("name = "):
            current_name = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("version = "):
            current_ver = line.split("=", 1)[1].strip().strip('"')
    if current_name and current_ver:
        deps.append((current_name, current_ver, "crates.io"))
    return deps


def _parse_dependencies(path: Path) -> list[tuple[str, str, str]]:
    name = path.name.lower()
    if name == "requirements.txt":
        return _iter_requirements(path)
    if name == "package-lock.json":
        return _iter_package_lock(path)
    if name == "go.sum":
        return _iter_go_sum(path)
    if name == "cargo.lock":
        return _iter_cargo_lock(path)
    return []


def _dependency_provenance(
    dep: tuple[str, str, str],
    *,
    manifest_path: str | None,
    chains: dict[tuple[str, str, str], list[str]],
) -> dict[str, Any]:
    name, version, ecosystem = dep
    level = "declared" if ecosystem == "PyPI" else "resolved"
    props: dict[str, Any] = {
        "reachability_level": level,
        "dependency_chain": chains.get(dep, [f"{name}@{version}"]),
    }
    if manifest_path is not None:
        props["manifest_path"] = manifest_path
    return props


_EVIDENCE_SEVERITY_CEILING = {
    "declared": Severity.LOW,
    "resolved": Severity.MEDIUM,
    "symbol-matched": Severity.HIGH,
    "call-path": Severity.HIGH,
    "runtime-observed": Severity.CRITICAL,
}


def _reported_severity(score: float, evidence_level: str) -> tuple[Severity, Severity]:
    raw = _severity_from_score(score)
    ceiling = _EVIDENCE_SEVERITY_CEILING[evidence_level]
    return raw, raw if SEVERITY_SCORE[raw] <= SEVERITY_SCORE[ceiling] else ceiling


def _dependency_chains(path: Path) -> dict[tuple[str, str, str], list[str]]:
    if path.name.lower() != "package-lock.json":
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    packages = payload.get("packages")
    if not isinstance(packages, dict):
        return {}
    chains: dict[tuple[str, str, str], list[str]] = {}
    for package_path, meta in packages.items():
        if not package_path.startswith("node_modules/") or not isinstance(meta, dict):
            continue
        name = meta.get("name") or package_path.rsplit("node_modules/", 1)[-1]
        version = meta.get("version")
        if not isinstance(name, str) or not isinstance(version, str):
            continue
        chain = [part.strip("/") for part in package_path.split("node_modules/")[1:] if part]
        chains[(name, version, "npm")] = chain or [f"{name}@{version}"]
    return chains


def _manifest_path(path: Path) -> str | None:
    workspace = Path(os.getenv("RAPTIX_WORKSPACE_PATH", Path.cwd())).resolve()
    try:
        return path.resolve().relative_to(workspace).as_posix()
    except ValueError:
        return None


# ── Knowledge graph internal services (Wave T4) ────────────────────────
#
# The former kg_add_node / kg_add_edge / kg_query / kg_neighbors /
# kg_stats / kg_backend_health @tool wrappers are plain importable
# services since Wave T4: agents read the graph through the semantic
# projections in ``research/semantic.py`` (search_knowledge,
# inspect_asset, find_attack_paths) and mutate it via ``kg_record`` /
# auto-ingest, never raw CRUD.


@kg_degrades
def kg_add_node(kind: str, label: str, props: str = "{}") -> str:
    """Insert or update a node in the engagement knowledge graph.

    WHEN TO USE: Every time you observe an asset, vulnerability, credential,
    entrypoint, crown jewel, or code location. The graph persists across
    Ralph iterations, so a node you add now is queryable by the next
    fresh-context agent.

    NODE KINDS: host, service, url, repo, file, code_location, vulnerability,
    cve, finding, credential, secret, user, entrypoint, crown_jewel, chain,
    hypothesis.

    IMPORTANT: Use ``props`` to store severity, file path, port, cwe, cvss,
    etc. Supply a deterministic ``key`` inside props for deduplication
    (e.g. ``"key": "10.0.0.1:443/tcp"``).

    Args:
        kind: Node type (see NODE KINDS above).
        label: Human-readable label shown in graph summaries.
        props: JSON object with extra fields. Example:
            ``{"severity": "high", "cwe": ["CWE-89"], "file": "app.py", "line": 42}``

    Returns:
        JSON with the created/updated node id and stats.
    """
    try:
        node_kind = NodeKind(kind)
    except ValueError:
        return _json({"error": f"unknown kind: {kind}", "valid": [k.value for k in NodeKind]})
    parsed = _parse_props(props)
    with graph_transaction() as graph:
        node = graph.upsert_node(Node.make(node_kind, label, **parsed))
        return _json(
            {"id": node.id, "kind": node.kind.value, "label": node.label, "stats": graph.stats()}
        )


@kg_degrades
def kg_add_edge(src: str, dst: str, kind: str, weight: float = 1.0) -> str:
    """Connect two nodes with a typed, weighted edge.

    WHEN TO USE: After adding nodes, connect them to express relationships
    the chain planner can walk: ``runs_on``, ``has_vuln``, ``enables``,
    ``leaks``, ``grants``, ``chains_to``, etc.

    WEIGHT guides the chain planner — lower = easier to exploit. Defaults
    to 1.0. Use 0.3 for trivial wins, 2.0 for painful pivots.

    EDGE KINDS: runs_on, exposes, has_vuln, defined_in, located_at,
    affected_by, mapped_to, auth_as, grants, leaks, enables, chains_to,
    reaches, starts_at, contains, validates.

    Args:
        src: Source node id (from kg_add_node return value).
        dst: Destination node id.
        kind: Edge type.
        weight: Traversal cost (lower = easier exploitation).

    Returns:
        JSON with edge id and updated graph stats.
    """
    try:
        edge_kind = EdgeKind(kind)
    except ValueError:
        return _json({"error": f"unknown edge kind: {kind}", "valid": [k.value for k in EdgeKind]})
    with graph_transaction() as graph:
        if src not in graph.nodes or dst not in graph.nodes:
            return _json(
                {
                    "error": "src or dst not in graph",
                    "src_present": src in graph.nodes,
                    "dst_present": dst in graph.nodes,
                }
            )
        edge = graph.upsert_edge(Edge.make(src, dst, edge_kind, weight=weight))
        return _json({"id": edge.id, "kind": edge.kind.value, "stats": graph.stats()})


@kg_degrades
def kg_query(kind: str = "", min_severity: str = "", limit: int = 25) -> str:
    """Query the knowledge graph for nodes matching kind / severity.

    WHEN TO USE: At the start of any iteration to discover what's already
    known. Before running a scanner, check if the target is already
    enumerated. Before exploiting, check for existing finding nodes.

    Args:
        kind: Node kind filter (empty = all kinds).
        min_severity: For vulnerability nodes only. Empty, low, medium,
            high, or critical. If set, only vulns meeting the bar are
            returned.
        limit: Max nodes to return (default 25).

    Returns:
        JSON list of matching nodes with their core fields and id.
    """
    with graph_transaction() as graph:
        if min_severity:
            try:
                sev = Severity(min_severity.lower())
            except ValueError:
                return _json({"error": f"bad severity: {min_severity}"})
            nodes = graph.vulnerabilities_by_severity(sev)
        elif kind:
            try:
                node_kind = NodeKind(kind)
            except ValueError:
                return _json({"error": f"unknown kind: {kind}"})
            nodes = graph.by_kind(node_kind)
        else:
            nodes = list(graph.nodes.values())

        return _json(
            {
                "total": len(nodes),
                "returned": min(len(nodes), limit),
                "nodes": [
                    {
                        "id": n.id,
                        "kind": n.kind.value,
                        "label": n.label,
                        "props": n.props,
                    }
                    for n in nodes[:limit]
                ],
            }
        )


@kg_degrades
def kg_neighbors(node_id: str, direction: str = "out", edge_kind: str = "") -> str:
    """Walk one hop out from a node to see what it connects to.

    Args:
        node_id: Source node id.
        direction: "out" (default), "in", or "both".
        edge_kind: Optional edge-kind filter.

    Returns:
        JSON list of {edge, neighbor} pairs.
    """
    with graph_transaction() as graph:
        if node_id not in graph.nodes:
            return _json({"error": "node not found", "id": node_id})
        filter_kind: EdgeKind | None = None
        if edge_kind:
            try:
                filter_kind = EdgeKind(edge_kind)
            except ValueError:
                return _json({"error": f"unknown edge kind: {edge_kind}"})
        neighbors = graph.neighbors(node_id, edge_kind=filter_kind, direction=direction)
        return _json(
            [
                {
                    "edge_kind": e.kind.value,
                    "edge_weight": e.weight,
                    "neighbor_id": n.id,
                    "neighbor_kind": n.kind.value,
                    "neighbor_label": n.label,
                }
                for e, n in neighbors
            ]
        )


@kg_degrades
def kg_stats() -> str:
    """Return counts of nodes and edges by kind. Cheapest way to sanity check
    graph state at iteration start. Returns JSON stats dict."""
    with graph_transaction() as graph:
        return _json({"backend": _kg_backend_name(), **graph.stats()})


@kg_degrades
def kg_backend_health() -> str:
    """Report KnowledgeGraph backend health/startup diagnostics.

    Use at session start (or when graph writes fail) to verify whether the
    configured backend is reachable and returning graph stats.
    """
    return _json(backend_health())


# ── CVE dependency enrichment ───────────────────────────────────────────


@tool
async def cve_enrich_dependencies(path: str, limit: int = 100, min_score: float = 7.0) -> str:
    """Parse a lockfile/manifest and enrich the graph with ranked CVE findings.

    Supported files:
      - requirements.txt
      - package-lock.json
      - go.sum
      - Cargo.lock
    """
    dep_path = Path(path)
    if not dep_path.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        deps = _parse_dependencies(dep_path)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        return _json({"error": f"dependency parse failed: {e}"})
    manifest_path = _manifest_path(dep_path)
    chains = _dependency_chains(dep_path)

    # Deduplicate and cap work for bounded runtime.
    dedup: dict[tuple[str, str, str], None] = {}
    for dep in deps:
        dedup[dep] = None
    planned = list(dedup.keys())[: max(limit, 1)]
    if not planned:
        return _json({"error": f"unsupported or empty dependency file: {dep_path.name}"})

    added = 0
    kept: list[dict[str, Any]] = []

    semaphore = asyncio.Semaphore(8)

    async def _lookup(
        dep: tuple[str, str, str],
    ) -> tuple[tuple[str, str, str], list[dict[str, Any]]]:
        name, version, ecosystem = dep
        async with semaphore:
            vuln_ids = await cve_mod.lookup_package(name, version, ecosystem)
        cve_ids = sorted(
            {vid for vid in vuln_ids if isinstance(vid, str) and vid.startswith("CVE-")}
        )
        if not cve_ids:
            return dep, []
        records = await cve_mod.lookup_cves(cve_ids, concurrency=6)
        return dep, [r.to_dict() for r in records if r.score >= min_score]

    results = await asyncio.gather(*[_lookup(dep) for dep in planned])

    with graph_transaction() as graph:
        for dep, records in results:
            name, version, ecosystem = dep
            provenance = _dependency_provenance(
                dep,
                manifest_path=manifest_path,
                chains=chains,
            )
            dep_node = graph.upsert_node(
                Node.make(
                    NodeKind.SERVICE,
                    f"{name}@{version}",
                    key=f"dependency::{ecosystem}::{name}@{version}",
                    component_type="dependency",
                    package=name,
                    version=version,
                    ecosystem=ecosystem,
                    source="dependency-enricher",
                    **provenance,
                )
            )

            for rec in records:
                cve_id = str(rec.get("cve_id") or "")
                if not cve_id.startswith("CVE-"):
                    continue
                score = float(rec.get("score") or 0.0)
                raw_severity, severity = _reported_severity(
                    score, str(provenance["reachability_level"])
                )
                cve_node = graph.upsert_node(
                    Node.make(
                        NodeKind.CVE,
                        cve_id,
                        key=f"cve::{cve_id}",
                        cvss=rec.get("cvss"),
                        epss=rec.get("epss"),
                        kev=rec.get("kev"),
                        score=score,
                        source="nvd+epss+osv",
                    )
                )
                vuln = graph.upsert_node(
                    Node.make(
                        NodeKind.VULNERABILITY,
                        f"{name}@{version} affected by {cve_id}",
                        key=f"dep-vuln::{ecosystem}::{name}@{version}::{cve_id}",
                        package=name,
                        version=version,
                        ecosystem=ecosystem,
                        cve_id=cve_id,
                        severity=severity.value,
                        raw_severity=raw_severity.value,
                        cvss=rec.get("cvss"),
                        cvss_vector=rec.get("cvss_vector"),
                        epss=rec.get("epss"),
                        epss_percentile=rec.get("epss_percentile"),
                        kev=rec.get("kev"),
                        score=score,
                        summary=rec.get("summary", ""),
                        references=rec.get("references", []),
                        source="dependency-enricher",
                        **provenance,
                    )
                )
                graph.upsert_edge(Edge.make(dep_node.id, cve_node.id, EdgeKind.AFFECTS, weight=0.5))
                graph.upsert_edge(Edge.make(dep_node.id, vuln.id, EdgeKind.HAS_VULN, weight=0.5))
                graph.upsert_edge(Edge.make(vuln.id, cve_node.id, EdgeKind.MAPS_TO, weight=0.5))
                kept.append(
                    {
                        "dependency": f"{name}@{version}",
                        "ecosystem": ecosystem,
                        "cve": cve_id,
                        "score": score,
                        "severity": severity.value,
                        "raw_severity": raw_severity.value,
                        "kev": bool(rec.get("kev")),
                        "dependency_chain": provenance["dependency_chain"],
                        "reachability_level": provenance["reachability_level"],
                    }
                )
                added += 1

    kept.sort(key=lambda x: x["score"], reverse=True)
    response: dict[str, Any] = {
        "dependencies_scanned": len(planned),
        "high_signal_records": added,
        "results": kept[:100],
        "stats": graph.stats(),
    }
    if manifest_path is not None:
        response["manifest_path"] = manifest_path
    return _json(response)


# ── Web/Auth signal ingestion ──────────────────────────────────────────


# Wave T4: duplicate-primitive collapse. ``kg_analyze_jwt`` /
# ``kg_analyze_oauth_callback`` / ``kg_analyze_cookie_value`` /
# ``kg_scan_solidity`` / ``kg_triage_binary`` are plain internal services
# now — their capability is carried by the domain-owned duplicates
# (jwt_parse / oauth_audit / cookie_audit / solidity_scan_file /
# bin_identify + bin_strings). Importable, never agent-facing.


@kg_degrades
def kg_analyze_jwt(token: str, source: str = "") -> str:
    """Parse a JWT and lift suspicious indicators into graph vulnerabilities."""
    parsed = parse_token(token)
    token_hash = hashlib.sha1(token.encode("utf-8"), usedforsecurity=False).hexdigest()[:12]

    with graph_transaction() as graph:
        entrypoint: Node | None = None

        if source:
            parsed_source = urlparse(source)
            if parsed_source.scheme and parsed_source.netloc:
                entrypoint = graph.upsert_node(
                    Node.make(
                        NodeKind.ENTRYPOINT,
                        source,
                        key=f"entrypoint::{source}",
                        source="jwt-analysis",
                        scheme=parsed_source.scheme,
                        host=parsed_source.hostname,
                        port=parsed_source.port,
                    )
                )
            else:
                entrypoint = graph.upsert_node(
                    Node.make(
                        NodeKind.FINDING,
                        source,
                        key=f"context::{source}",
                        source="jwt-analysis",
                    )
                )

        created = 0
        finding_nodes: list[dict[str, Any]] = []
        for idx, finding in enumerate(parsed.findings, start=1):
            severity = _jwt_finding_severity(finding)
            vuln = graph.upsert_node(
                Node.make(
                    NodeKind.VULNERABILITY,
                    f"[jwt] {finding}",
                    key=f"jwt::{token_hash}::{idx}",
                    scanner="jwt-analysis",
                    severity=severity.value,
                    finding=finding,
                    source=source or None,
                    alg=parsed.header.alg,
                    kid=parsed.header.kid,
                    jku=parsed.header.jku,
                )
            )
            if entrypoint is not None:
                graph.upsert_edge(Edge.make(entrypoint.id, vuln.id, EdgeKind.HAS_VULN, weight=0.4))
            finding_nodes.append(
                {
                    "id": vuln.id,
                    "severity": severity.value,
                    "finding": finding,
                }
            )
            created += 1

        return _json(
            {
                "token_hash": token_hash,
                "header": parsed.header.to_dict(),
                "claims": parsed.claims.to_dict(),
                "findings": parsed.findings,
                "ingested_vulnerabilities": created,
                "nodes": finding_nodes,
                "stats": graph.stats(),
            }
        )


@kg_degrades
def kg_analyze_oauth_callback(
    callback_url: str,
    initial_request_url: str = "",
    public_client: bool = False,
    source: str = "",
) -> str:
    """Analyze OAuth/OIDC callback flow and ingest findings."""
    findings = analyze_oauth_callback(
        callback_url=callback_url,
        initial_request_url=initial_request_url or None,
        public_client=public_client,
    )

    with graph_transaction() as graph:
        entry_label = source or callback_url
        parsed_source = urlparse(entry_label)
        entrypoint = graph.upsert_node(
            Node.make(
                NodeKind.ENTRYPOINT,
                entry_label,
                key=f"entrypoint::{entry_label}",
                source="oauth-analysis",
                scheme=parsed_source.scheme or None,
                host=parsed_source.hostname or None,
                port=parsed_source.port,
            )
        )

        ingested: list[dict[str, Any]] = []
        for finding in findings:
            severity = _severity_from_string(finding.severity)
            vuln = graph.upsert_node(
                Node.make(
                    NodeKind.VULNERABILITY,
                    f"[oauth:{finding.id}] {finding.title}",
                    key=f"oauth::{finding.id}::{entry_label}",
                    scanner="oauth-analysis",
                    rule_id=finding.id,
                    severity=severity.value,
                    description=finding.detail,
                    recommendation=finding.recommendation,
                )
            )
            graph.upsert_edge(Edge.make(entrypoint.id, vuln.id, EdgeKind.HAS_VULN, weight=0.4))
            ingested.append(
                {
                    "id": vuln.id,
                    "rule_id": finding.id,
                    "severity": severity.value,
                    "title": finding.title,
                }
            )

        return _json(
            {
                "callback_url": callback_url,
                "findings": [f.to_dict() for f in findings],
                "ingested_vulnerabilities": len(ingested),
                "nodes": ingested,
                "stats": graph.stats(),
            }
        )


@kg_degrades
def kg_analyze_cookie_value(
    name: str,
    value: str,
    secure: bool = False,
    http_only: bool = False,
    same_site: str = "",
    source: str = "",
) -> str:
    """Analyze a cookie/session token and persist suspicious findings."""
    analysis = analyze_cookie(
        name=name,
        value=value,
        secure=secure,
        http_only=http_only,
        same_site=(same_site or None),
    )

    with graph_transaction() as graph:
        entrypoint: Node | None = None
        if source:
            parsed_source = urlparse(source)
            if parsed_source.scheme and parsed_source.netloc:
                entrypoint = graph.upsert_node(
                    Node.make(
                        NodeKind.ENTRYPOINT,
                        source,
                        key=f"entrypoint::{source}",
                        source="cookie-analysis",
                        scheme=parsed_source.scheme,
                        host=parsed_source.hostname,
                        port=parsed_source.port,
                    )
                )

        created: list[dict[str, Any]] = []
        cookie_hash = hashlib.sha1(
            f"{name}:{value}".encode("utf-8"), usedforsecurity=False
        ).hexdigest()[:12]
        for idx, finding in enumerate(analysis.findings, start=1):
            severity = _cookie_finding_severity(finding)
            vuln = graph.upsert_node(
                Node.make(
                    NodeKind.VULNERABILITY,
                    f"[cookie:{name}] {finding}",
                    key=f"cookie::{cookie_hash}::{idx}",
                    scanner="cookie-analysis",
                    severity=severity.value,
                    cookie_name=name,
                    framework=analysis.framework,
                    cookie_format=analysis.format,
                    source=source or None,
                )
            )
            if entrypoint is not None:
                graph.upsert_edge(Edge.make(entrypoint.id, vuln.id, EdgeKind.HAS_VULN, weight=0.5))
            created.append({"id": vuln.id, "severity": severity.value, "finding": finding})

        if analysis.format == "jwt" and isinstance(analysis.decoded, dict):
            secret = graph.upsert_node(
                Node.make(
                    NodeKind.SECRET,
                    f"cookie::{name}",
                    key=f"cookie-secret::{cookie_hash}",
                    source="cookie-analysis",
                    format="jwt",
                    decoded=analysis.decoded,
                )
            )
            if entrypoint is not None:
                graph.upsert_edge(Edge.make(entrypoint.id, secret.id, EdgeKind.LEAKS, weight=0.5))

        return _json(
            {
                "analysis": analysis.to_dict(),
                "ingested_vulnerabilities": len(created),
                "nodes": created,
                "stats": graph.stats(),
            }
        )


# ── Smart contract ingestion ───────────────────────────────────────────


@kg_degrades
def kg_scan_solidity(
    path: str, min_severity: str = "low", scanner_hint: str = "solidity-patterns"
) -> str:
    """Scan Solidity source with offline heuristics and ingest findings."""
    source_path = Path(path)
    if not source_path.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        source = source_path.read_text(encoding="utf-8")
    except OSError as e:
        return _json({"error": f"failed to read solidity file: {e}"})

    findings = scan_solidity_source(source)
    threshold = _severity_threshold(_severity_from_string(min_severity))

    with graph_transaction() as graph:
        ingested = 0
        by_severity: dict[str, int] = {}

        file_node = graph.upsert_node(
            Node.make(
                NodeKind.SOURCE_FILE,
                str(source_path),
                key=f"file::{source_path}",
                source=scanner_hint,
                language="solidity",
            )
        )

        for finding in findings:
            if _severity_threshold(finding.severity) < threshold:
                continue
            vuln = graph.upsert_node(
                Node.make(
                    NodeKind.VULNERABILITY,
                    f"[{scanner_hint}:{finding.rule}] {source_path.name}:{finding.line}",
                    key=f"{scanner_hint}::{source_path}::{finding.rule}::{finding.line}",
                    scanner=scanner_hint,
                    rule_id=finding.rule,
                    severity=finding.severity.value,
                    description=finding.description,
                    recommendation=finding.recommendation,
                    cwe=[finding.cwe] if finding.cwe else [],
                    file=str(source_path),
                    line=finding.line,
                )
            )
            loc = graph.upsert_node(
                Node.make(
                    NodeKind.CODE_LOCATION,
                    f"{source_path}:{finding.line}",
                    key=f"{source_path}::{finding.line}",
                    file=str(source_path),
                    start_line=finding.line,
                )
            )
            graph.upsert_edge(Edge.make(vuln.id, loc.id, EdgeKind.DEFINED_IN))
            graph.upsert_edge(Edge.make(loc.id, file_node.id, EdgeKind.DEFINED_IN))
            by_severity[finding.severity.value] = by_severity.get(finding.severity.value, 0) + 1
            ingested += 1

        return _json(
            {
                "file": str(source_path),
                "matches": len(findings),
                "ingested": ingested,
                "by_severity": by_severity,
                "stats": graph.stats(),
            }
        )


# ── Binary triage ingestion ────────────────────────────────────────────


@kg_degrades
def kg_triage_binary(path: str, max_strings: int = 400) -> str:
    """Triage a binary for exploit-relevant signals and persist graph entities."""
    binary_path = Path(path)
    if not binary_path.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        blob = binary_path.read_bytes()
    except OSError as e:
        return _json({"error": f"failed to read binary: {e}"})

    info = identify_binary(binary_path)
    packer = detect_packer(blob)
    extracted = extract_strings(blob)
    if max_strings > 0:
        extracted = extracted[:max_strings]
    grouped = group_by_category(extracted)
    import_tokens: list[str] = []
    for entry in grouped.get("import", []):
        for token in re.split(r"[^A-Za-z0-9_@.]+", entry.text):
            if token:
                import_tokens.append(token)
    symbols = summarize_symbols(import_tokens)

    with graph_transaction() as graph:
        file_node = graph.upsert_node(
            Node.make(
                NodeKind.SOURCE_FILE,
                str(binary_path),
                key=f"binary::{binary_path}",
                source="binary-triage",
                binary_format=info.format,
                architecture=info.architecture,
                bitness=info.bitness,
                nx=info.nx,
                pie=info.pie,
                relro=info.relro,
                canary=info.canary,
                packed=packer.likely_packed,
                entropy=round(packer.entropy, 3),
            )
        )

        created: list[dict[str, Any]] = []

        def _add_binary_vuln(
            rule_id: str, severity: Severity, description: str, **props: Any
        ) -> None:
            vuln = graph.upsert_node(
                Node.make(
                    NodeKind.VULNERABILITY,
                    f"[binary:{rule_id}] {binary_path.name}",
                    key=f"binary::{binary_path}::{rule_id}",
                    scanner="binary-triage",
                    rule_id=rule_id,
                    severity=severity.value,
                    description=description,
                    file=str(binary_path),
                    **props,
                )
            )
            graph.upsert_edge(Edge.make(file_node.id, vuln.id, EdgeKind.HAS_VULN, weight=0.6))
            created.append({"id": vuln.id, "rule_id": rule_id, "severity": severity.value})

        if info.nx is False:
            _add_binary_vuln(
                "hardening.nx-disabled",
                Severity.MEDIUM,
                "NX appears disabled; memory corruption is easier to weaponize.",
            )
        if info.pie is False:
            _add_binary_vuln(
                "hardening.pie-disabled",
                Severity.MEDIUM,
                "PIE appears disabled; ASLR entropy is reduced for code pointers.",
            )
        if grouped.get("secret"):
            sample = [s.text[:80] for s in grouped["secret"][:5]]
            _add_binary_vuln(
                "secrets.hardcoded",
                Severity.HIGH,
                "Potential hardcoded secrets were found in binary strings.",
                sample=sample,
            )
        if symbols.command_exec and (symbols.dangerous_c or symbols.dynamic_code):
            sev = Severity.CRITICAL if symbols.network else Severity.HIGH
            _add_binary_vuln(
                "rce.primitives",
                sev,
                "Binary imports command-execution primitives plus memory-unsafe APIs.",
                command_exec=symbols.command_exec,
                dangerous_c=symbols.dangerous_c,
                dynamic_code=symbols.dynamic_code,
                network=symbols.network,
            )

        if packer.likely_packed:
            hypothesis = graph.upsert_node(
                Node.make(
                    NodeKind.HYPOTHESIS,
                    f"Packed binary candidate: {binary_path.name}",
                    key=f"binary-packed::{binary_path}",
                    source="binary-triage",
                    entropy=round(packer.entropy, 3),
                    signatures=packer.signatures,
                    notes=packer.notes,
                )
            )
            graph.upsert_edge(Edge.make(file_node.id, hypothesis.id, EdgeKind.CONTAINS, weight=1.2))

        entrypoints_added = 0
        for s in grouped.get("url", [])[:25]:
            url_node = graph.upsert_node(
                Node.make(
                    NodeKind.URL,
                    s.text,
                    key=f"url::{s.text}",
                    source="binary-triage",
                    offset=s.offset,
                )
            )
            ep = graph.upsert_node(
                Node.make(
                    NodeKind.ENTRYPOINT,
                    s.text,
                    key=f"entrypoint::{s.text}",
                    source="binary-triage",
                )
            )
            graph.upsert_edge(Edge.make(file_node.id, url_node.id, EdgeKind.CONTAINS, weight=0.8))
            graph.upsert_edge(Edge.make(url_node.id, ep.id, EdgeKind.EXPOSES, weight=0.7))
            entrypoints_added += 1

        return _json(
            {
                "binary": info.to_dict(),
                "packer": packer.to_dict(),
                "string_category_counts": {k: len(v) for k, v in grouped.items()},
                "symbol_report": symbols.to_dict(),
                "created_vulnerabilities": created,
                "entrypoints_added": entrypoints_added,
                "stats": graph.stats(),
            }
        )


# ── Public tool list ────────────────────────────────────────────────────
#
# cve_lookup/cve_by_package (:mod:`.cve`), plan_attack_chains/
# suggest_objectives_from_chains (:mod:`.chain`), fuzz_classify/
# fuzz_harness/fuzz_record_crash (:mod:`.fuzz`), validate_finding
# (:mod:`.poc`), and all 14 kg_ingest_* services (:mod:`.ingest_services`)
# are imported above and assembled into RESEARCH_TOOLS below — see each
# module for its own tool definitions. Of the 14 kg_ingest_* services, 9
# (nmap_xml, nuclei_jsonl, httpx_jsonl, katana_jsonl, subfinder, dnsx,
# ffuf, masscan, gobuster) are internal-only: KGAutoIngestMiddleware
# auto-detects their bash invocation and parses through the
# ``knowledge/ingest`` ParserRegistry instead. The remaining 5 (sarif,
# slither, testssl, crackmapexec, asrep_hashes) keep their ``@tool``
# decorator and RESEARCH_TOOLS membership — see ``ingest_services.py``'s
# module docstring for why they don't fit the auto-ingest
# command-detection model yet.
#
# Wave T4: the raw KG CRUD/read tools (kg_add_node, kg_add_edge,
# kg_query, kg_neighbors, kg_stats, kg_backend_health),
# kg_dedupe_findings, and the five duplicate analysis twins
# (kg_analyze_jwt, kg_analyze_oauth_callback, kg_analyze_cookie_value,
# kg_scan_solidity, kg_triage_binary) are internal services now — agents
# read the graph through the semantic projections (search_knowledge /
# inspect_asset / find_attack_paths) and write through kg_record /
# auto-ingest; the twins' capabilities are carried by the domain-owned
# duplicates (jwt_parse / oauth_audit / cookie_audit /
# solidity_scan_file / bin_identify + bin_strings). ``rank_candidates``
# and ``kg_add_candidate`` in SCANNER_TOOLS deliberately keep their
# ``@tool`` decorators: the scanner pipeline's documented workflow
# invokes them as discrete steps of the scan capability (prompts/
# scanner.md, skills corpus), and no auto-wired replacement exists yet
# — revisit at T10 (bounded workers), not before.

RESEARCH_TOOLS = [
    search_knowledge,
    inspect_asset,
    find_attack_paths,
    kg_ingest_sarif,
    kg_ingest_slither,
    kg_ingest_testssl,
    kg_ingest_crackmapexec,
    kg_ingest_asrep_hashes,
    cve_lookup,
    cve_by_package,
    cve_enrich_dependencies,
    plan_attack_chains,
    suggest_objectives_from_chains,
    fuzz_classify,
    fuzz_harness,
    fuzz_record_crash,
    validate_finding,
    scan_secrets,
    detect_tech_stack,
    *SCANNER_TOOLS,
    *PATCH_TOOLS,
    *OSINT_TOOLS,
]
