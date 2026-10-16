"""Agent-facing KG tools — ``kg_record`` and ``kg_ingest``.

Built by :func:`build_kg_tools` and attached to ``KGMiddleware.tools``
so ``langchain.agents.create_agent`` merges them into the agent's
toolset at compile time. The tools never accept ``engagement`` from
the LLM; the middleware injects it via ``InjectedState`` and the store
re-pulls it inside ``record_observations`` / ``ingest`` so an
``InjectedState`` override bug (open issue
``langchain-ai/langchain#31688``) cannot escape the engagement scope.

Surface (minimal per the design notes):

  - ``kg_record(observations)``           — atomic batch write of nodes
                                            and outgoing edges.
  - ``kg_ingest(scanner_kind, path)``     — dispatcher into the scanner
                                            adapter registry.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Annotated, Any

from langchain_core.tools import InjectedToolCallId, tool
from langgraph.prebuilt import InjectedState

from raptix.knowledge.graph.ingest import ingest as _ingest_dispatch
from raptix.knowledge.graph.store import KGStore

DEFAULT_KG_TOOLS = frozenset({"kg_record", "kg_ingest"})
SURFACE_INVENTORY_TOOL = "kg_surface_inventory"
CHALLENGE_INVENTORY_TOOL = "challenge_inventory"

# Snapshot locations the recon objectives already write on scoreboard-first
# missions; the tool also accepts an explicit path argument.
_CHALLENGE_SNAPSHOT_CANDIDATES = (
    "/workspace/recon/challenges.json",
    "/workspace/recon/api/Challenges.json",
    "/workspace/recon/api/challenges.json",
    "/workspace/recon/probe_api_Challenges.txt",
    "/workspace/challenges.json",
)

_ENGAGEMENT_UNSET = (
    "kg_engagement is not set on agent state; middleware before_agent did not hydrate"
)


def _resolve_engagement(state: dict[str, Any] | None) -> str:
    """Pull the engagement label from state with a fall-back to
    ``engagement_name`` (the upstream EngagementContextMiddleware field)."""
    if not isinstance(state, dict):
        return ""
    return str(state.get("kg_engagement") or state.get("engagement_name") or "").strip()


def _resolve_created_by(state: dict[str, Any] | None) -> str:
    """Best-effort agent identity for provenance. Falls back to a
    constant string so the trusted ``record_observations`` invariant
    holds even when the agent role is missing from state."""
    if not isinstance(state, dict):
        return "agent"
    role = state.get("role") or state.get("agent_name") or state.get("kg_created_by")
    if isinstance(role, str) and role:
        return role
    return "agent"


def _err(message: str) -> str:
    return json.dumps({"error": message})


def build_kg_tools(
    store: KGStore,
    enabled: Iterable[str] | None = None,
) -> list[Any]:
    """Construct the agent-facing KG tools bound to a single store.

    ``enabled`` selects which tools land in the returned list. Default
    is ``DEFAULT_KG_TOOLS`` (kg_record + kg_ingest). Plugin authors
    that ship a third KG tool can pass ``{"kg_record", "kg_ingest",
    "kg_my_custom_tool"}`` in conjunction with subclassing
    ``KGMiddleware`` to append the extra tool factory.
    """
    enabled_set: set[str] = set(enabled) if enabled is not None else set(DEFAULT_KG_TOOLS)
    tools: list[Any] = []

    if "kg_record" in enabled_set:

        @tool
        def kg_record(
            observations: str,
            state: Annotated[dict, InjectedState],
            tool_call_id: Annotated[str, InjectedToolCallId] = "",
        ) -> str:
            """Record one or more graph observations atomically.

            The middleware injects engagement scope + provenance — you
            only pass the observations. All observations in one call
            land in a single Neo4j transaction; partial failure rolls
            back the batch.

            ``observations`` is a JSON-encoded list. Each entry:

              {
                "kind": "Host" | "Service" | "Vulnerability" | ... ,
                "key": "host::10.0.0.1",        # deterministic dedup key
                "label": "10.0.0.1",
                "props": {"ip": "10.0.0.1", "explored": false, ...},
                "edges_out": [
                  {"to_key": "service::10.0.0.1:80",
                   "kind": "HOSTS", "weight": 0.5}
                ]
              }

            Reserved provenance keys (engagement, firstseen, lastupdated,
            created_by, source_episode_id) are stripped from your props
            silently — the middleware sets them.

            Returns JSON: {"created": N, "merged": M, "edges": E,
            "revision": "..."}.
            """
            engagement = _resolve_engagement(state)
            if not engagement:
                return _err(_ENGAGEMENT_UNSET)

            try:
                obs_list = json.loads(observations)
            except (TypeError, ValueError) as exc:
                return _err(f"observations must be valid JSON list: {exc}")
            if not isinstance(obs_list, list):
                return _err("observations must be a JSON list of observation dicts")

            try:
                result = store.record_observations(
                    obs_list,
                    engagement=engagement,
                    created_by=_resolve_created_by(state),
                    source_episode_id=tool_call_id or "no-tool-call-id",
                )
            except ValueError as exc:
                return _err(str(exc))
            except Exception as exc:  # noqa: BLE001 — surface to LLM
                return _err(f"kg_record failed: {exc}")
            return json.dumps(result)

        tools.append(kg_record)

    if "kg_ingest" in enabled_set:

        @tool
        def kg_ingest(
            scanner_kind: str,
            path: str,
            state: Annotated[dict, InjectedState],
            tool_call_id: Annotated[str, InjectedToolCallId] = "",
        ) -> str:
            """Ingest a scanner output file into the engagement graph.

            ``scanner_kind`` selects an adapter from the registry. Built-ins:
              nmap_xml, nuclei_jsonl, httpx_jsonl, sarif.

            ``path`` is an absolute file path inside the sandbox / host
            (the adapter reads it directly). Examples:
              kg_ingest("nmap_xml", "/workspace/scan.xml")
              kg_ingest("sarif",    "/workspace/semgrep.sarif")

            Returns JSON: {"scanner": "...", "path": "...",
            "ingested": ...} on success, or
            {"error": "...", "available": [...]} when ``scanner_kind``
            is unknown.
            """
            engagement = _resolve_engagement(state)
            if not engagement:
                return _err(_ENGAGEMENT_UNSET)

            try:
                result = _ingest_dispatch(
                    scanner_kind,
                    path,
                    store=store,
                    engagement=engagement,
                    created_by=_resolve_created_by(state),
                    source_episode_id=tool_call_id or "no-tool-call-id",
                )
            except Exception as exc:  # noqa: BLE001 — surface to LLM
                return _err(f"kg_ingest failed: {exc}")
            return json.dumps(result)

        tools.append(kg_ingest)

    if SURFACE_INVENTORY_TOOL in enabled_set:

        @tool
        def kg_surface_inventory(
            state: Annotated[dict, InjectedState],
            base_generation: int | None = None,
            tool_call_id: Annotated[str, InjectedToolCallId] = "",
        ) -> str:
            """Read the Endpoint inventory and derive bounded coverage cells.

            This is read-only. The returned ``objective_children`` are inputs
            for the orchestrator's sequential ``objective_expand`` call — but
            only worth calling when ``recommended_in_flight`` is 2 or more;
            below that, continue the single-agent recon-to-exploit handoff
            instead of building the matrix. On re-expansion, ``base_generation``
            stamps children with the next code-owned generation before the
            bounds are applied.
            """
            engagement = _resolve_engagement(state)
            if not engagement:
                return _err(_ENGAGEMENT_UNSET)
            try:
                # Agent-only planners must not run during middleware package import.
                from raptix.intelligence.agents.standard._surface_reexpand import plan_reexpansion
                from raptix.intelligence.agents.standard._surface_registry import (
                    build_coverage_matrix,
                    build_objective_expand_payload,
                    independent_cell_count,
                    recommended_in_flight,
                    surfaces_from_kg_inventory,
                )

                rows = store.execute_read(
                    (
                        "MATCH (e:Endpoint) WHERE e.engagement = $engagement "
                        "OPTIONAL MATCH (e)-[r]->(child) "
                        "WHERE r.engagement = $engagement "
                        "  AND child.engagement = $engagement "
                        "WITH e, collect(CASE WHEN child IS NULL THEN null ELSE "
                        "{kind: head(labels(child)), key: child.key, label: child.label, "
                        "props: properties(child)} END) AS children "
                        "RETURN e.key AS key, properties(e) AS props, children "
                        "ORDER BY e.key LIMIT $limit"
                    ),
                    {"limit": 500},
                    engagement=engagement,
                )
                surfaces = surfaces_from_kg_inventory(rows)
                derived_cells = build_coverage_matrix(surfaces)
                cells = plan_reexpansion(
                    state.get("objectives", []),
                    derived_cells,
                    base_generation=base_generation,
                )
                payload = build_objective_expand_payload("", cells)
                return json.dumps(
                    {
                        "surfaces": surfaces,
                        "cells": cells,
                        "objective_children": payload["children"],
                        "independent_count": independent_cell_count(cells),
                        "recommended_in_flight": recommended_in_flight(cells, surfaces),
                    }
                )
            except Exception as exc:  # noqa: BLE001 — surface read failures to the orchestrator
                return _err(f"kg_surface_inventory failed: {exc}")

        tools.append(kg_surface_inventory)

    if CHALLENGE_INVENTORY_TOOL in enabled_set:

        @tool
        def challenge_inventory(
            state: Annotated[dict, InjectedState],
            path: str = "",
            tool_call_id: Annotated[str, InjectedToolCallId] = "",
        ) -> str:
            """Derive coverage cells from the mission's own scoreboard.

            Read-only. Parses the challenge snapshot recon already pulled
            (``GET /api/Challenges`` saved under ``/workspace/recon/``, or
            the file passed as ``path``) and returns exactly one bounded
            cell per unsolved entry — one win-condition each — plus the
            ``objective_children`` inputs for the orchestrator's
            sequential ``objective_expand`` call. Cells already present in
            the OPPLAN (same ``cell_id``) are filtered out. Categories and
            difficulties are the target's own vocabulary; no target-
            specific content is baked into the mapping and hints are
            deliberately never ingested (see
            docs/adr/0075-challenge-inventory.md).
            """
            engagement = _resolve_engagement(state)
            if not engagement:
                return _err(_ENGAGEMENT_UNSET)
            try:
                # Agent-only planners must not run during middleware package import.
                from pathlib import Path

                from raptix.intelligence.agents.standard._challenge_registry import (
                    build_challenge_cells,
                    build_challenge_children,
                    find_snapshot_file,
                    parse_challenge_snapshot,
                )
                from raptix.intelligence.agents.standard._surface_reexpand import (
                    plan_reexpansion,
                )

                candidates = (path,) if path else _CHALLENGE_SNAPSHOT_CANDIDATES
                snapshot = find_snapshot_file(candidates)
                if snapshot is None:
                    return _err(
                        "no challenge snapshot found; pull GET /api/Challenges with "
                        "http_request and save it to /workspace/recon/challenges.json, "
                        "then call challenge_inventory again (or pass path=...)"
                    )
                challenges = parse_challenge_snapshot(
                    Path(snapshot).read_text(encoding="utf-8", errors="replace")
                )
                derived_cells = build_challenge_cells(challenges)
                cells = plan_reexpansion(state.get("objectives", []), derived_cells)
                children = build_challenge_children(cells)
                entries = [
                    {
                        "challenge_id": cell["challenge_id"],
                        "challenge_name": cell["challenge_name"],
                        "category": cell["category"],
                        "difficulty": cell["difficulty"],
                        "skill_path": cell["skill_path"],
                        "roe_gated": bool(cell.get("roe_gated")),
                    }
                    for cell in cells
                ]
                return json.dumps(
                    {
                        "source": str(snapshot),
                        "challenge_count": len(challenges),
                        "unsolved_cells": len(cells),
                        "entries": entries,
                        "objective_children": children,
                    }
                )
            except Exception as exc:  # noqa: BLE001 — snapshot read failures to the orchestrator
                return _err(f"challenge_inventory failed: {exc}")

        tools.append(challenge_inventory)

    return tools
