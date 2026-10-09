"""Scanner-output ingest services — lift on-disk tool output into the KG.

Of the 14 former ``kg_ingest_*`` scanner-output tools, 9 are internal
services here (``nmap_xml``, ``nuclei_jsonl``, ``httpx_jsonl``, ``katana_jsonl``,
``subfinder``, ``dnsx``, ``ffuf``, ``masscan``, ``gobuster``): each has a
clean, auto-detectable ``<binary> ... -o <file>``-shaped bash invocation, so
``KGAutoIngestMiddleware`` (L2a) parses their output automatically — no
``@tool`` decorator, absent from every ``*_TOOLS`` list, resolved through
the ``knowledge.ingest`` ParserRegistry instead of parsing inline. They
stay importable for callers and middleware.

The other 5 — ``kg_ingest_sarif``, ``kg_ingest_slither``,
``kg_ingest_testssl``, ``kg_ingest_crackmapexec``, ``kg_ingest_asrep_hashes``
— stay ``@tool``-decorated and in ``RESEARCH_TOOLS``. Their source tools
(SARIF scanners, Slither, testssl.sh, crackmapexec/netexec,
impacket-GetNPUsers) are conventionally invoked with output redirected to
a file (``> out.txt`` / piped) rather than through a single predictable
output flag — ``KGAutoIngestMiddleware`` explicitly refuses to auto-ingest
a command containing shell redirection, so there is no safe, evidence-based
way to auto-detect their output path yet. Guessing a flag convention here
risked silently ingesting the wrong content; keeping them as explicit tool
calls was the conservative choice until a future wave designs the right
heuristic for this invocation shape.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from langchain_core.tools import tool

from raptix.execution.tools.contracts.slither import ingest_slither_file
from raptix.execution.tools.research._state import _json, graph_transaction, kg_degrades
from raptix.execution.tools.research.sarif import ingest_sarif_file
from raptix.knowledge.ingest import (
    ParseError,
    ParseOutcome,
    apply_observations,
    default_registry,
)
from raptix_core.types.capability import Artifact

# ── Parser registry dispatch (Wave T3) ──────────────────────────────────
#
# The former inline kg_ingest_* parsing bodies moved to
# ``knowledge/ingest/parsers/``; these internal services keep their
# signatures and JSON responses but resolve content through the
# parser registry instead of parsing + writing inline.

_INGEST_REGISTRY = default_registry()


def _parse_content(content: bytes, format_id: str, metadata: dict[str, Any]) -> ParseOutcome:
    """Route raw scanner output through the parser registry."""
    digest = hashlib.sha256(content).hexdigest()
    artifact = Artifact(
        id=f"kg-ingest::{digest[:16]}",
        artifact_ref=f"sha256://{digest}",
        format_hint=format_id,
        content_type="application/octet-stream",
        sha256=digest,
        producer="kg_ingest",
        metadata=metadata,
    )
    return _INGEST_REGISTRY.parse(artifact, content, expected_formats=(format_id,))


# ── Static analysis ingestion ───────────────────────────────────────────


@tool
@kg_degrades
def kg_ingest_sarif(path: str, scanner_hint: str = "") -> str:
    """Ingest a SARIF report (semgrep, bandit, gitleaks, trivy, codeql) into the graph.

    WHEN TO USE: After running any SARIF-emitting scanner. Lifts every
    ``result`` in the file into a Vulnerability node linked to its
    CodeLocation and File, so the chain planner can reason about
    source-level bugs.

    EXAMPLES:
        semgrep --sarif --config=auto /workspace/src > /workspace/semgrep.sarif
        bandit -r /workspace/src -f sarif -o /workspace/bandit.sarif
        gitleaks detect --source /workspace/src --report-format sarif --report-path /workspace/gitleaks.sarif

    Args:
        path: Absolute path to the SARIF file (must be inside the sandbox
            workspace or host bind mount).
        scanner_hint: Override the scanner name. Useful when the SARIF
            driver name is anonymised or mislabeled.

    Returns:
        JSON with the ingested result count and updated graph stats.
    """
    hint = scanner_hint or None
    with graph_transaction() as graph:
        n = ingest_sarif_file(path, graph, scanner_hint=hint)
        return _json({"ingested": n, "stats": graph.stats()})


# ── Recon report ingestion ──────────────────────────────────────────────


@kg_degrades
def kg_ingest_nmap_xml(path: str, scanner_hint: str = "nmap") -> str:
    """Ingest Nmap XML output into the knowledge graph.

    This creates host/service nodes and adds entrypoint nodes for common web
    ports so chain planning can start from externally reachable surfaces.
    """
    try:
        content = Path(path).read_bytes()
    except OSError as exc:
        return _json({"error": f"failed to parse nmap xml: {exc}"})
    try:
        outcome = _parse_content(content, "nmap_xml", {"scanner_hint": scanner_hint})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({"ingested": dict(outcome.summary), "stats": graph.stats()})


@kg_degrades
def kg_ingest_nuclei_jsonl(path: str, scanner_hint: str = "nuclei") -> str:
    """Ingest Nuclei JSONL output into the knowledge graph.

    Expected format is one JSON object per line (`nuclei -jsonl` output).
    """
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(p.read_bytes(), "nuclei_jsonl", {"scanner_hint": scanner_hint})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


@kg_degrades
def kg_ingest_subfinder(path: str, root_domain: str = "") -> str:
    """Ingest subfinder plaintext output (one subdomain per line).

    Creates host nodes and HTTP/HTTPS entrypoints so chain planning can
    target internet-exposed surfaces directly.
    """
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(p.read_bytes(), "subfinder", {"root_domain": root_domain})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


@kg_degrades
def kg_ingest_httpx_jsonl(path: str, scanner_hint: str = "httpx") -> str:
    """Ingest httpx JSONL output into host/service/entrypoint graph nodes."""
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(p.read_bytes(), "httpx_jsonl", {"scanner_hint": scanner_hint})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


# ── Smart contract ingestion ───────────────────────────────────────────


@tool
@kg_degrades
def kg_ingest_slither(path: str) -> str:
    """Ingest Slither JSON output into the engagement KG.

    Writes flow directly through ``KGStore.record_observations`` —
    a single atomic batch per file. The engagement label is resolved
    from the ``EngagementContextMiddleware`` contextvar; falls back
    to the shared ``_LEGACY_ENGAGEMENT_LABEL`` outside the standard
    middleware stack (matches the convention used by the rest of
    RESEARCH_TOOLS).
    """
    from raptix.execution.tools.research._engagement_scope import _LEGACY_ENGAGEMENT_LABEL
    from raptix_core.utils.engagement_scope import get_active_engagement

    engagement = get_active_engagement() or _LEGACY_ENGAGEMENT_LABEL
    try:
        ingested = ingest_slither_file(path, engagement=engagement)
    except ValueError as exc:
        return _json({"error": str(exc)})
    return _json({"ingested": ingested})


# ── Tier 2 ingesters (Kali tool output → knowledge graph) ─────────────


@kg_degrades
def kg_ingest_dnsx(path: str) -> str:
    """Ingest dnsx JSONL output (one resolution record per line).

    Creates host nodes for each resolved name and adds a short note on
    the record type (A / AAAA / CNAME) when present.
    """
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(p.read_bytes(), "dnsx", {})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


@kg_degrades
def kg_ingest_katana(path: str) -> str:
    """Ingest katana JSONL crawl output as URL / entrypoint nodes."""
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(p.read_bytes(), "katana_jsonl", {})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


@kg_degrades
def kg_ingest_masscan(path: str) -> str:
    """Ingest masscan JSON output into host + service nodes.

    Masscan writes a JSON array where each entry has ``ip`` and
    ``ports: [{port, proto, status}]``. State is usually ``open``.
    """
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(p.read_bytes(), "masscan", {})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


@kg_degrades
def kg_ingest_ffuf(path: str) -> str:
    """Ingest ffuf JSON output as URL nodes anchored to a host.

    Each hit becomes an ENTRYPOINT/URL pair with the matched status
    code recorded as a property.
    """
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(p.read_bytes(), "ffuf", {})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


@kg_degrades
def kg_ingest_gobuster(path: str, base_url: str) -> str:
    """Ingest Gobuster `dir -o` text hits for an explicitly supplied web root."""
    root = urlparse(base_url)
    if (
        root.scheme not in {"http", "https"}
        or not root.hostname
        or root.username is not None
        or root.password is not None
        or root.query
        or root.fragment
    ):
        return _json({"error": "base_url must be an http(s) URL without userinfo"})
    p = Path(path)
    try:
        if p.stat().st_size > 1_000_000:
            return _json({"error": "gobuster output exceeds 1 MB"})
        lines = p.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        return _json({"error": f"failed to read gobuster output: {exc}"})

    try:
        outcome = _parse_content(
            "\n".join(lines).encode("utf-8"), "gobuster", {"base_url": base_url}
        )
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


@tool
@kg_degrades
def kg_ingest_testssl(path: str, target: str = "") -> str:
    """Ingest testssl.sh JSON output as TLS vulnerability nodes.

    testssl.sh emits an array of findings with ``id``, ``severity``,
    ``finding`` fields. We map the severity labels onto the graph's
    ``Severity`` enum and create a VULNERABILITY node per HIGH/CRIT
    finding, linked to a HOST node derived from ``target`` (``host`` or
    ``host:port``) so the chain planner can follow testssl findings.

    If ``target`` is empty, we try to read it from the testssl JSON
    envelope (``targetHost``/``target``). Vulnerability nodes are still
    created when no host is resolvable, but they won't participate in
    attack-chain traversal — prefer to pass ``target`` explicitly.
    """
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(p.read_bytes(), "testssl", {"target": target})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


@tool
@kg_degrades
def kg_ingest_crackmapexec(path: str, protocol: str = "smb", target: str = "") -> str:
    """Ingest a crackmapexec / netexec log file as credential leads.

    CME log format is loose, so we use line regexes to find ``[+]``
    success rows carrying ``DOMAIN\\user:pass`` or NTLM hashes, then
    create ``CREDENTIAL`` nodes + optional ``USER`` nodes in the graph.
    """
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(
            p.read_bytes(), "crackmapexec", {"protocol": protocol, "target": target}
        )
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})


@tool
@kg_degrades
def kg_ingest_asrep_hashes(path: str, domain: str = "") -> str:
    """Ingest an ``impacket-GetNPUsers`` output file as credential leads.

    AS-REP hashes look like ``$krb5asrep$23$user@DOMAIN:...``. Each
    line creates a CREDENTIAL node tagged for hashcat mode 18200.
    """
    p = Path(path)
    if not p.exists():
        return _json({"error": f"file not found: {path}"})

    try:
        outcome = _parse_content(p.read_bytes(), "asrep_hashes", {"domain": domain})
    except ParseError as exc:
        return _json({"error": str(exc)})
    with graph_transaction() as graph:
        apply_observations(graph, outcome.observations)
        return _json({**dict(outcome.summary), "stats": graph.stats()})
