"""Reporting services (plain functions) + the agent-facing ``generate_report`` tool.

Wave T5 collapsed the five format-specific report tools into one
operator-facing ``generate_report(format, ...)``; the per-format
renderers below stay importable as internal services (never-delete
rule), and ``research/bounty.py``'s ``format_bounty_report`` joined
them as the ``bounty`` format (per the T1 classification note that
``generate_report(format=...)`` should absorb both).

The reporting surface reads the engagement KG that ``KGMiddleware``
and ``kg_record`` / ``kg_ingest`` write to (the post-#545 backend).
The engagement label is resolved from the
``EngagementContextMiddleware`` contextvar; if it is not set (e.g.
agent invoked outside the standard middleware stack), reports render
from an empty graph and the agent can recover.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from langchain_core.tools import tool

from raptix.execution.tools.reporting.bugcrowd import render_bugcrowd_csv
from raptix.execution.tools.reporting.executive import render_executive_summary
from raptix.execution.tools.reporting.hackerone import render_hackerone_markdown
from raptix.execution.tools.reporting.kg_adapter import load_engagement_graph
from raptix.execution.tools.reporting.sarif import render_sarif
from raptix.execution.tools.reporting.timeline import extract_timeline
from raptix_core.types.kg import KnowledgeGraph
from raptix_core.utils.engagement_scope import get_active_engagement

#: Report formats accepted by ``generate_report``.
REPORT_FORMATS = ("hackerone", "bugcrowd_csv", "executive", "timeline", "sarif", "bounty")


def _load() -> tuple[KnowledgeGraph, None]:
    """Load the engagement KG for reporting.

    Reads the engagement label from the contextvar
    (``EngagementContextMiddleware`` sets it for every tool dispatch).
    Returns an empty graph when no engagement is active so the renderer
    sees a well-formed (but empty) shape.

    Kept under this name so the existing ``mock.patch(
    "raptix.execution.tools.reporting.tools._load", ...)`` test surface
    continues to work — only the implementation changed.
    """
    engagement = get_active_engagement()
    if not engagement:
        return KnowledgeGraph(), None
    return load_engagement_graph(engagement), None


def _json(data: Any) -> str:
    return json.dumps(data, indent=2, default=str, ensure_ascii=False)


def report_hackerone(finding_id: str) -> str:
    """Render a HackerOne-style markdown report for a finding or vulnerability node."""
    graph, _ = _load()
    node = graph.nodes.get(finding_id)
    if node is None:
        return _json({"error": f"no node {finding_id} in graph"})
    md = render_hackerone_markdown(node, graph=graph)
    return _json({"id": finding_id, "markdown": md})


def report_bugcrowd_csv(min_severity: str = "medium") -> str:
    """Render the current graph as a Bugcrowd CSV submission bundle."""
    graph, _ = _load()
    csv = render_bugcrowd_csv(graph, min_severity=min_severity)
    return _json({"rows": csv.count("\n") - 1, "csv": csv})


def report_executive(engagement_name: str = "Engagement") -> str:
    """Produce an engagement-level executive summary from the graph."""
    graph, _ = _load()
    md = render_executive_summary(graph, engagement_name=engagement_name)
    return _json({"markdown": md})


def report_timeline() -> str:
    """Extract a chronological timeline of graph events."""
    graph, _ = _load()
    events = extract_timeline(graph)
    return _json({"count": len(events), "events": [e.to_dict() for e in events]})


def report_sarif(engagement_id: str, output_path: str) -> str:
    """Render the engagement graph as SARIF v2.1.0 JSON.

    Writes UTF-8 to ``output_path`` (parent directories are created) and
    returns a JSON summary with the engagement id, written path, byte
    count, and number of result entries emitted.
    """
    graph, _ = _load()
    sarif = render_sarif(graph, engagement_id=engagement_id)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(sarif, encoding="utf-8")
    payload = json.loads(sarif)
    results = payload["runs"][0]["results"]
    return _json(
        {
            "engagement_id": engagement_id,
            "path": str(path),
            "bytes": len(sarif.encode("utf-8")),
            "results": len(results),
        }
    )


@tool
def generate_report(
    format: str,
    finding_id: str = "",
    output_path: str = "",
    min_severity: str = "medium",
    engagement_name: str = "Engagement",
    engagement_id: str = "",
    platform: str = "hackerone",
    program_name: str = "",
    component_name: str = "",
) -> str:
    """Render an engagement report in one supported format.

    The operator/finalization surface — attack workers never format
    reports. Picks the renderer automatically; you never call the
    per-format renderers directly.

    Formats:
        - ``hackerone``   — markdown report for one finding
          (requires ``finding_id``)
        - ``bugcrowd_csv`` — whole-graph CSV submission bundle
        - ``executive``   — engagement-level executive summary
        - ``timeline``    — chronological graph-event timeline
        - ``sarif``       — SARIF v2.1.0 file for scanners/DefectDojo
          (requires ``engagement_id`` and ``output_path``)
        - ``bounty``      — platform-ready bounty report from a
          validated finding (requires ``finding_id``; optional
          ``platform`` / ``program_name`` / ``component_name``)

    Example:
        generate_report("executive")
        generate_report("hackerone", finding_id="ab12cd34")
        generate_report("sarif", engagement_id="eng-X", output_path="/workspace/out.sarif")
    """
    fmt = format.strip().lower()
    if fmt not in REPORT_FORMATS:
        return _json({"error": f"unknown format: {format}", "valid": list(REPORT_FORMATS)})
    if fmt == "hackerone":
        if not finding_id:
            return _json({"error": "format 'hackerone' requires finding_id"})
        return report_hackerone(finding_id)
    if fmt == "bugcrowd_csv":
        return report_bugcrowd_csv(min_severity=min_severity)
    if fmt == "executive":
        return report_executive(engagement_name=engagement_name)
    if fmt == "timeline":
        return report_timeline()
    if fmt == "sarif":
        if not engagement_id or not output_path:
            return _json({"error": "format 'sarif' requires engagement_id and output_path"})
        return report_sarif(engagement_id=engagement_id, output_path=output_path)
    # fmt == "bounty"
    if not finding_id:
        return _json({"error": "format 'bounty' requires finding_id"})
    from raptix.execution.tools.research.bounty import format_bounty_report

    return format_bounty_report(
        finding_id,
        platform=platform,
        program_name=program_name,
        component_name=component_name,
    )


REPORTING_TOOLS = [generate_report]
