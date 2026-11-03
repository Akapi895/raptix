"""Bounded MCP discovery with stable identities and no connection secrets in reports."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from collections.abc import Awaitable, Callable
from hashlib import sha256
from importlib.util import find_spec
from typing import Any
from urllib.parse import quote

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import StructuredTool

from raptix.execution.tools.mcp.client import (
    ENV_SERVERS,
    MCPConnectionError,
    _read_env_servers,
    load_mcp_tools,
)
from raptix.intelligence.agents.specialist_catalog import capability_metadata

log = logging.getLogger(__name__)


async def mcp_io(operation: Callable[[], Awaitable[Any]], timeout: float) -> Any:
    """Keep SDK filesystem/subprocess setup off the server loop; propagate cancellation."""
    owner = asyncio.get_running_loop()
    ready = owner.create_future()

    def worker() -> Any:
        async def run() -> Any:
            loop, task = asyncio.get_running_loop(), asyncio.current_task()
            owner.call_soon_threadsafe(ready.set_result, (loop, task))
            async with asyncio.timeout(timeout):
                return await operation()

        # Blockbuster also diagnoses SDK setup in private worker loops. Its
        # task-local suppression is confined to this bounded worker, never the
        # server event loop or the outer approval/scope middleware.
        diagnostic = getattr(sys.modules.get("blockbuster.blockbuster"), "blockbuster_skip", None)
        token = diagnostic.set(True) if diagnostic is not None else None
        try:
            return asyncio.run(run())
        finally:
            if diagnostic is not None:
                diagnostic.reset(token)

    job = asyncio.create_task(asyncio.to_thread(worker))
    try:
        return await asyncio.shield(job)
    except asyncio.CancelledError as cancelled:
        loop, task = await asyncio.shield(ready)
        if not job.done():
            try:
                loop.call_soon_threadsafe(task.cancel)
            except RuntimeError:
                log.debug("MCP worker finished while cancellation was being delivered")
        try:
            await asyncio.shield(job)
        finally:
            raise cancelled


def bounded_mcp_tool(remote: Any, identity: str, server: str) -> StructuredTool:
    async def invoke(config: RunnableConfig, **arguments: Any) -> Any:
        try:
            return await mcp_io(lambda: remote.ainvoke(arguments, config=config), 30)
        except TimeoutError:
            raise MCPConnectionError(f"MCP tool on server {server!r} timed out") from None

    name = "mcp_" + sha256(identity.encode()).hexdigest()[:20]
    return StructuredTool.from_function(
        coroutine=invoke,
        name=name,
        description=remote.description,
        args_schema=remote.args_schema,
        metadata={"mcp_server": server, "mcp_tool": remote.name},
    )


async def discover_mcp(
    selected_servers: set[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    async def discover(server: Any) -> tuple[dict[str, Any], dict[str, Any]]:
        report = {
            "id": server.name,
            "name": server.name,
            "configured": True,
            "enabled": True,
            "installed": find_spec("langchain_mcp_adapters") is not None,
            "reachable": False,
            "available": False,
            "status": "disconnected",
            "tools": [],
            "requirements": [],
        }
        try:
            tools = await mcp_io(lambda: load_mcp_tools((server,), strict=True), 12)
            report.update(reachable=True, available=True, status="connected")
            catalog = {}
            for remote in tools:
                identity = "mcp:" + quote(server.name, safe="") + ":" + quote(remote.name, safe="")
                if identity in catalog:
                    raise MCPConnectionError("MCP server returned duplicate tool names")
                catalog[identity] = bounded_mcp_tool(remote, identity, server.name)
                report["tools"].append(
                    capability_metadata(
                        identity,
                        remote.name,
                        remote.description,
                        server.name,
                        runtime_name=catalog[identity].name,
                    )
                )
            return report, catalog
        except (MCPConnectionError, TimeoutError):
            report.update(
                status="unavailable",
                available=False,
                tools=[],
                error="Connection failed. Check runtime MCP transport, credentials and dependency installation.",
            )
            return report, {}

    configured = _read_env_servers()
    invalid = []
    raw = os.environ.get(ENV_SERVERS, "").strip()
    if raw:
        try:
            entries = json.loads(raw)
        except json.JSONDecodeError:
            entries = None
        invalid_names = (
            [str(name) for name in entries if name not in {s.name for s in configured}]
            if isinstance(entries, dict)
            else ["Runtime MCP configuration"]
        )
        invalid = [
            {
                "id": name,
                "name": name,
                "configured": False,
                "enabled": False,
                "installed": find_spec("langchain_mcp_adapters") is not None,
                "reachable": False,
                "available": False,
                "status": "unavailable",
                "tools": [],
                "requirements": ["Valid RAPTIX_MCP__SERVERS configuration"],
                "error": "Invalid runtime MCP configuration. Use a JSON object with valid per-server transport settings.",
            }
            for name in invalid_names
            if selected_servers is None or name in selected_servers
        ]
    servers = [s for s in configured if selected_servers is None or s.name in selected_servers]
    discovered = await asyncio.gather(*(discover(s) for s in servers))
    return [*invalid, *(r for r, _ in discovered)], {
        identity: tool for _, catalog in discovered for identity, tool in catalog.items()
    }
