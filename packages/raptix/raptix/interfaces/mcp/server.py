"""FastMCP server exposing Raptix engagement control to external agents.

This is the seam that makes external agent runtimes (OpenClaw, Hermes, or any
MCP client) able to *drive* Raptix like its CLI — from a phone, via those
agents' chat channels. The full surface:

- ``raptix_list_graphs`` / ``raptix_list_engagements`` — discover & resume
- ``raptix_start_engagement`` — launch an authorized engagement
- ``raptix_send_message`` — steer / answer / ``/model`` switch mid-run
- ``raptix_transcript`` — watch the orchestrator narrative incrementally
- ``raptix_watch`` — tail the live sub-agent stream for a few seconds
- ``raptix_engagement_state`` — inspect OPPLAN / scope / phase
- ``raptix_engagement_status`` / ``raptix_engagement_findings`` — status & SARIF
- ``raptix_cancel_engagement`` — stop a run

The server is a thin control plane. The red-team work runs inside the
Raptix LangGraph server (RoE enforcement, sandbox, knowledge-graph
persistence); this module only translates MCP tool calls into LangGraph runs
and reads persisted state/findings back.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from raptix.interfaces.mcp.auth import build_auth
from raptix.interfaces.mcp.config import ServerConfig, load_config
from raptix.interfaces.mcp.engagements import EngagementClient
from raptix.interfaces.mcp.tools_interactive import register_interactive_tools
from raptix.interfaces.mcp.tools_lifecycle import register_lifecycle_tools


def build_server(
    config: ServerConfig | None = None,
    *,
    client: Any | None = None,
    host: str = "127.0.0.1",
    port: int = 8765,
) -> FastMCP:
    """Construct the Raptix engagement MCP server with all tools registered.

    ``client`` injects a pre-built LangGraph SDK client (tests/embedding);
    production callers leave it ``None`` so it is created from ``config``.
    """
    cfg = config or load_config()
    engagements = EngagementClient(cfg, client=client)
    verifier, auth = build_auth(cfg, host=host, port=port)
    mcp = FastMCP("raptix", host=host, port=port, token_verifier=verifier, auth=auth)
    register_lifecycle_tools(mcp, engagements, cfg)
    register_interactive_tools(mcp, engagements)
    return mcp
