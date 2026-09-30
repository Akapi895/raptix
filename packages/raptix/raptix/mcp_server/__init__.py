"""Decepticon engagement MCP server.

Exposes Decepticon engagement control — list graphs, start/monitor/cancel an
engagement, and pull findings — over the Model Context Protocol so external
agent runtimes such as OpenClaw and Hermes can drive Decepticon as a tool.

The server SDK (``mcp``) is an optional dependency: install with
``pip install 'decepticon[mcp]'``. Importing this package is safe without it;
only :func:`main` and :func:`raptix.mcp_server.server.build_server`
require the SDK.
"""

from __future__ import annotations

from raptix.mcp_server.__main__ import main
from raptix.mcp_server.config import ServerConfig, load_config

__all__ = ["ServerConfig", "load_config", "main"]
