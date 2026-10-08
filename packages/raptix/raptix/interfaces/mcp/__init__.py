"""MCP server interface (W14, migrated from ``raptix.mcp_server``).

Transport and protocol-facing code for the MCP bridge. No business logic —
delegates to runtime subsystems for engagement management, conversation
state, and finding retrieval.

The server SDK (``mcp``) is an optional dependency: install with
``pip install 'decepticon[mcp]'``. Importing this package is safe without it;
only :func:`main` and :func:`raptix.interfaces.mcp.server.build_server`
require the SDK.
"""

from __future__ import annotations

from raptix.interfaces.mcp.__main__ import main
from raptix.interfaces.mcp.config import ServerConfig, load_config

__all__ = ["ServerConfig", "load_config", "main"]
