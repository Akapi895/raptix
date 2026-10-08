"""LangChain @tool wrappers for the smart contract audit package."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from langchain_core.tools import tool
from raptix_contracts import tools as contract_tools
from raptix_contracts.patterns import scan_solidity_source

from raptix.execution.tools.contracts.slither import (
    ingest_slither_json as _ingest_slither_json_impl,
)
from raptix.execution.tools.research._engagement_scope import _LEGACY_ENGAGEMENT_LABEL
from raptix_core.utils.engagement_scope import get_active_engagement


def _json(data: Any) -> str:
    return json.dumps(data, indent=2, default=str, ensure_ascii=False)


def _resolve_engagement() -> str:
    """Engagement label for Slither ingest writes.

    Falls back to the shared ``_LEGACY_ENGAGEMENT_LABEL`` when the
    ``EngagementContextMiddleware`` contextvar is unset — matches the
    convention used by the AD ingest path.
    """
    return get_active_engagement() or _LEGACY_ENGAGEMENT_LABEL


solidity_scan = tool(contract_tools.solidity_scan)


@tool
def solidity_scan_file(path: str) -> str:
    """Read a .sol file from disk and run the pattern scanner."""
    try:
        src = Path(path).read_text(encoding="utf-8")
    except OSError as e:
        return _json({"error": str(e)})
    findings = scan_solidity_source(src)
    return _json(
        {"file": path, "count": len(findings), "findings": [f.to_dict() for f in findings]}
    )


# Wave T4 duplicate-ingest-path pick: ``kg_ingest_slither``
# (execution/tools/research/tools.py, routed through the T3
# ``knowledge/ingest`` ParserRegistry) is the one canonical Slither
# ingest path. This thin duplicate keeps its signature and JSON
# responses for importers but is no longer an agent-facing tool.
def slither_ingest(path: str) -> str:
    """Ingest a Slither ``--json -`` output file into the engagement KG.

    Writes flow directly through ``KGStore.record_observations`` — a
    single atomic batch per file. Workflow: run ``slither . --json
    out.json`` then call this tool with the path to ``out.json``.
    """
    try:
        data = Path(path).read_text(encoding="utf-8")
    except OSError as e:
        return _json({"error": str(e)})
    engagement = _resolve_engagement()
    try:
        count = _ingest_slither_json_impl(data, engagement=engagement)
    except ValueError as exc:
        return _json({"error": str(exc)})
    return _json({"ingested": count})


foundry_reentrancy_test = tool(contract_tools.foundry_reentrancy_test)
foundry_access_test = tool(contract_tools.foundry_access_test)
foundry_flashloan_test = tool(contract_tools.foundry_flashloan_test)


# slither_ingest is a Wave T4 internal service (see its comment) —
# kg_ingest_slither in RESEARCH_TOOLS is the canonical ingest path.
CONTRACT_TOOLS = [
    solidity_scan,
    solidity_scan_file,
    foundry_reentrancy_test,
    foundry_access_test,
    foundry_flashloan_test,
]
