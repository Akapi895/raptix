"""Blue Cell detection-coverage tool — the runtime that closes the loop.

The Offensive Vaccine pipeline documents a ``Defender`` that writes Sigma
rules, but nothing in the OSS ever ran those rules against the agent's own
activity (``docs/features/blue-cell.md``). ``blue_cell_scan`` is that missing
runtime: it replays the engagement's sandbox session logs through the shipped
:class:`~raptix.blue_cell.tap.BlueCellTap` +
:class:`~raptix.blue_cell.rule_match.RuleMatcher`, and records every rule
that fires as a ``DetectionFired`` node in the knowledge graph — linked
``-[:USES_RULE]->`` the ``DefenseAction`` (the rule artifact) and
``-[:DETECTED]->`` the offensive ``Finding`` / ``Technique`` it caught.

Recording is deterministic and idempotent (matching, not the LLM, decides
what fired), and detection timing is write-once so repeated scans never
inflate MTTD. The agent narrates the returned coverage summary — including
the **detection gaps** (Findings with no ``DETECTED`` edge) — into a Defense
Brief.
"""

from __future__ import annotations

import hashlib
import statistics
import tempfile
import time
from pathlib import Path
from typing import Any

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from raptix.blue_cell.rule_match import RuleMatcher, load_rules
from raptix.blue_cell.tap import BlueCellTap, TapEvent
from raptix.execution.backends.project_files import (
    WORKSPACE_ROOT,
    ProjectFileUnavailable,
    ambient_project_files,
)
from raptix.execution.tools.research._state import _json, graph_transaction
from raptix_core.types.kg import Edge, EdgeKind, KnowledgeGraph, Node, NodeKind

# Bundled baseline ruleset — schema reference + bootstrap coverage. Operators
# point ``rules_path`` at their Detector-produced ruleset for real engagements.
_BUNDLED_RULES: Path = Path(__file__).resolve().parents[3] / "blue_cell" / "sample_rules.jsonl"

# Node kinds whose technique tags a fired rule can be attributed to.
_ATTRIBUTABLE: tuple[NodeKind, ...] = (NodeKind.FINDING, NodeKind.TECHNIQUE)


def _resolve_workspace(workspace_path: str, config: RunnableConfig | None) -> str:
    """Explicit arg → runnable config → ``/workspace``. Only the project's own /workspace or a folder in it is valid."""
    if workspace_path:
        return workspace_path
    configurable = (config or {}).get("configurable", {}) if config else {}
    from_config = configurable.get("workspace_path") if isinstance(configurable, dict) else None
    if from_config:
        return str(from_config)
    return WORKSPACE_ROOT


def _workspace_rel(workspace: str) -> str:
    """The workspace folder relative to the project's /workspace ('' for the root itself)."""
    base = workspace.rstrip("/") or WORKSPACE_ROOT
    if base != WORKSPACE_ROOT and not base.startswith(f"{WORKSPACE_ROOT}/"):
        raise ValueError(f"workspace_path must be {WORKSPACE_ROOT} or a folder inside it")
    return base[len(WORKSPACE_ROOT) + 1 :]


def _read_session_events(workspace_rel: str) -> list[TapEvent]:
    """The sandbox's session and target logs, replayed through the tap from a scratch copy (ADR-0102).

    The tap reads local files, so the logs come in from the project's sandbox into a scratch folder with the same
    ``.sessions/`` layout, and the source names it derives stay the same.
    """
    files = ambient_project_files()
    sessions = f"{workspace_rel}/.sessions" if workspace_rel else ".sessions"
    with tempfile.TemporaryDirectory() as staging:
        root = Path(staging)
        for name in files.list_files(sessions) or []:
            if Path(name).suffix not in {".log", ".jsonl"}:
                continue
            data = files.read_bytes(f"{sessions}/{name}")
            if data is None:
                continue
            target = root / ".sessions" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        return BlueCellTap(root).read_batch()


def node_techniques(node: Node) -> set[str]:
    """MITRE technique IDs a node carries, across the prop spellings in use."""
    out: set[str] = set()
    for key in ("technique_id", "technique", "mitre", "mitre_techniques"):
        val = node.props.get(key)
        if isinstance(val, str):
            out.add(val)
        elif isinstance(val, (list, tuple)):
            out.update(str(v) for v in val)
    return out


def _attribution_targets(graph: KnowledgeGraph, technique: str) -> list[Node]:
    """Finding/Technique nodes a detection for ``technique`` should link to."""
    return [
        node
        for node in graph.nodes.values()
        if node.kind in _ATTRIBUTABLE and technique in node_techniques(node)
    ]


def _detection_key(rule_id: str, source: str, raw_line: str, seq: int) -> str:
    """Stable, scan-independent identity for one detected event.

    The DetectionFired node MUST key on the underlying *event content*, not on
    ``event_ts``: for un-timestamped session logs (the default — the sandbox
    pipes raw pane output verbatim) ``BlueCellTap`` stamps each line with the
    scan's wall-clock, so keying on ``event_ts`` minted a brand-new node on
    every re-scan and inflated counts/MTTD. Hashing ``(source, raw line)``
    makes a re-scan of the same log idempotent and gives two distinct command
    lines that fire the same rule two distinct nodes. ``seq`` disambiguates a
    byte-identical line that legitimately recurs in the same source (stable
    because logs are append-only and replayed in full each scan).
    """
    digest = hashlib.sha1(f"{source}\x00{raw_line}".encode("utf-8", "replace")).hexdigest()[:16]
    return f"detection::{rule_id}::{digest}::{seq}"


def _record_hit(graph: KnowledgeGraph, source: str, detection: Any, *, key: str) -> float:
    """Upsert the DefenseAction + DetectionFired pair and edges for one hit.

    Detection timing is write-once: a re-scan of the same logged event (same
    content ``key``) preserves the first-seen ``detection_ts`` / ``mttd_seconds``
    so periodic scanning never inflates MTTD. Returns the recorded MTTD in
    seconds. (MTTD is only meaningful when the session log line carried its own
    leading timestamp; for un-timestamped lines ``event_ts`` is the scan time,
    so MTTD reflects first-sighting latency, not true time-to-detect.)
    """
    rule = detection.rule
    action = graph.upsert_node(
        Node.make(
            NodeKind.DEFENSE_ACTION,
            rule.title,
            key=f"rule::{rule.id}",
            rule_id=rule.id,
            level=rule.level,
            mitre=list(rule.mitre),
        )
    )
    fired = Node.make(
        NodeKind.DETECTION_FIRED,
        rule.title,
        key=key,
        rule_id=rule.id,
        rule_title=rule.title,
        rule_level=rule.level,
        mitre=list(rule.mitre),
        matched_fields=dict(detection.matched_fields),
        event_ts=detection.event_ts,
        detection_ts=detection.detection_ts,
        mttd_seconds=detection.mttd_seconds,
        source=source,
    )
    prior = graph.nodes.get(fired.id)
    if prior is not None and "detection_ts" in prior.props:
        fired.props["detection_ts"] = prior.props["detection_ts"]
        fired.props["mttd_seconds"] = prior.props["mttd_seconds"]
    fired = graph.upsert_node(fired)
    graph.upsert_edge(Edge.make(fired.id, action.id, EdgeKind.USES_RULE))
    for technique in rule.mitre:
        for target in _attribution_targets(graph, technique):
            graph.upsert_edge(Edge.make(fired.id, target.id, EdgeKind.DETECTED, key=technique))
    return float(fired.props["mttd_seconds"])


def _scan_and_record(
    graph: KnowledgeGraph, *, workspace_rel: str, rules_path: str, now_ts: float
) -> dict[str, Any]:
    """Replay the tap, evaluate rules, record detections, return coverage."""
    rules_path = rules_path or str(_BUNDLED_RULES)
    rules = load_rules(rules_path)
    matcher = RuleMatcher(rules)
    events = _read_session_events(workspace_rel)

    detections = 0
    techniques: set[str] = set()
    mttds: list[float] = []
    seen: dict[str, int] = {}
    for event in events:
        payload = event.to_dict()
        source = str(payload["source"])
        raw_line = str(payload.get("raw") or payload["actor"]["command_line"] or "")
        for hit in matcher.match(payload, now_ts=now_ts):
            base = f"{hit.rule.id}::{source}::{raw_line}"
            seq = seen.get(base, 0)
            seen[base] = seq + 1
            key = _detection_key(hit.rule.id, source, raw_line, seq)
            mttds.append(_record_hit(graph, source, hit, key=key))
            techniques.update(hit.rule.mitre)
            detections += 1

    findings = graph.by_kind(NodeKind.FINDING)
    gaps = [
        f.label
        for f in findings
        if not graph.neighbors(f.id, edge_kind=EdgeKind.DETECTED, direction="in")
    ]
    return {
        "rules_loaded": len(rules),
        "rules_path": rules_path,
        "events_scanned": len(events),
        "detections": detections,
        "techniques_detected": sorted(techniques),
        "median_mttd_seconds": round(statistics.median(mttds), 2) if mttds else None,
        "findings_total": len(findings),
        "findings_detected": len(findings) - len(gaps),
        "detection_gaps": gaps,
    }


@tool
def blue_cell_scan(
    workspace_path: str = "",
    rules_path: str = "",
    config: RunnableConfig | None = None,
) -> str:
    """Score detection rules against Red Cell's own activity and record coverage.

    Replays the engagement's sandbox session logs, evaluates every detection
    rule against them, and writes a ``DetectionFired`` node per hit (linked to
    the rule and to the offensive Finding/Technique it caught). Re-running is
    safe and idempotent — detection timing is preserved from first sighting.

    WHEN TO USE: after offensive activity has run, to produce the engagement's
    proven detection-coverage picture (what fired, how fast, and — most
    importantly — which Findings nothing detected).

    Args:
        workspace_path: Engagement workspace root holding ``.sessions/``.
            Defaults to the runnable config /
            ``/workspace``.
        rules_path: JSONL file or directory of detection rules. Defaults to
            the bundled baseline ruleset; point this at the Detector's output
            for a real engagement.

    Returns:
        JSON coverage summary: rules loaded, events scanned, detections,
        techniques detected, median MTTD, and the detection-gap Finding list.
    """
    try:
        workspace_rel = _workspace_rel(_resolve_workspace(workspace_path, config))
    except ValueError as exc:
        return _json({"error": str(exc)})
    try:
        with graph_transaction() as graph:
            return _json(
                _scan_and_record(
                    graph,
                    workspace_rel=workspace_rel,
                    rules_path=rules_path,
                    now_ts=time.time(),
                )
            )
    except ProjectFileUnavailable as exc:
        return _json({"error": f"the project sandbox could not be read: {exc}"})


BLUE_CELL_TOOLS = [blue_cell_scan]

__all__ = ["BLUE_CELL_TOOLS", "blue_cell_scan"]
