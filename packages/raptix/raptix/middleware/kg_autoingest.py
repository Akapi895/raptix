"""Ingest bounded scanner output after a successful bash tool call."""

from __future__ import annotations

import asyncio
import logging
import os
import posixpath
import shlex
import tempfile
import threading
from pathlib import Path
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage

from raptix.knowledge.graph.ingest import ingest
from raptix.knowledge.graph.store import KGStore
from raptix.middleware.filesystem import _normalize_engagement_workspace

log = logging.getLogger(__name__)

_MAX_BYTES = 256_000
_MAX_SECONDS = 4
_SCANNERS = {
    "nmap": ("nmap_xml", "-oX"),
    "httpx": ("httpx_jsonl", "-o"),
    "nuclei": ("nuclei_jsonl", "-o"),
    "katana": ("katana_jsonl", "-o"),
    "arjun": ("arjun_json", "-oJ"),
}


def _output(command: str) -> tuple[str, str] | None:
    try:
        args = shlex.split(command)
    except ValueError:
        return None
    if not args or any(part in {";", "&&", "||", "|", ">", "<"} for part in args):
        return None
    scanner = _SCANNERS.get(posixpath.basename(args[0]))
    if scanner is None:
        return None
    kind, output_flag = scanner
    if posixpath.basename(args[0]) == "httpx" and "-json" not in args:
        return None
    if posixpath.basename(args[0]) == "nuclei" and not any(
        flag in args for flag in ("-jsonl", "-json")
    ):
        return None
    if posixpath.basename(args[0]) == "katana" and "-jsonl" not in args:
        return None
    if posixpath.basename(args[0]) == "arjun" and "-oJ" not in args:
        return None
    if args.count(output_flag) != 1:
        return None
    index = args.index(output_flag) + 1
    return (kind, args[index]) if index < len(args) else None


class KGAutoIngestMiddleware(AgentMiddleware):
    """Best-effort KG writes; never replace the tool's response."""

    def __init__(self, *, store: KGStore, sandbox: Any, role: str) -> None:
        super().__init__()
        self._store = store
        self._sandbox = sandbox
        self._role = role
        self._slots = threading.BoundedSemaphore(value=2)

    async def awrap_tool_call(self, request: Any, handler: Any) -> Any:
        result = await handler(request)
        if os.environ.get("RAPTIX_KG_AUTOINGEST", "0").lower() not in {"1", "true", "yes"}:
            return result
        try:
            await asyncio.wait_for(
                asyncio.to_thread(self._bounded_ingest, request, result), timeout=_MAX_SECONDS
            )
        except Exception as exc:
            log.debug("KG auto-ingest skipped: %s", exc)
        return result

    def _bounded_ingest(self, request: Any, result: Any) -> None:
        if not self._slots.acquire(blocking=False):
            return
        try:
            self._ingest_result(request, result)
        finally:
            self._slots.release()

    def _ingest_result(self, request: Any, result: Any) -> None:
        if getattr(getattr(request, "tool", None), "name", None) != "bash":
            return
        if not isinstance(result, ToolMessage) or result.status != "success":
            return
        if not isinstance(result.content, str) or not result.content.rstrip().endswith(
            "[Exit code: 0]"
        ):
            return
        tool_call = getattr(request, "tool_call", None)
        if not isinstance(tool_call, dict) or not isinstance(tool_call.get("args"), dict):
            return
        if tool_call["args"].get("background") or tool_call["args"].get("is_input"):
            return
        command = tool_call["args"].get("command")
        selected = _output(command) if isinstance(command, str) else None
        if selected is None:
            return
        kind, output_path = selected
        state = getattr(request, "state", None) or {}
        engagement = state.get("kg_engagement") or state.get("engagement_name")
        workspace = _normalize_engagement_workspace(state.get("workspace_path"))
        if not isinstance(engagement, str) or not engagement or workspace is None:
            return
        if output_path == "-" and kind == "nmap_xml":
            output = result.content.rsplit("\n[Exit code: 0]", 1)[0]
            content = output.encode("utf-8")
            if not output.lstrip().startswith(("<?xml", "<nmaprun")):
                return
        else:
            if (
                not output_path.startswith(f"{workspace}/")
                or posixpath.normpath(output_path) != output_path
                or len(output_path) > 512
            ):
                return
            sandbox = self._sandbox
            runtime = getattr(request, "runtime", None)
            if runtime is not None and getattr(runtime, "config", None):
                from raptix.backends.factory import build_sandbox_backend

                sandbox = build_sandbox_backend(runtime.config)
            entries = sandbox.ls_info(posixpath.dirname(output_path))
            file_info = next((entry for entry in entries if entry.get("path") == output_path), None)
            size = file_info.get("size") if file_info is not None else None
            if not isinstance(size, int):
                return
            if size > _MAX_BYTES:
                return
            downloaded = sandbox.download_files([output_path])
            if len(downloaded) != 1 or downloaded[0].error:
                return
            content = downloaded[0].content
        if not content or len(content) > _MAX_BYTES:
            return
        with tempfile.TemporaryDirectory(prefix="raptix-kg-") as directory:
            path = Path(directory) / "scan"
            path.write_bytes(content)
            outcome = ingest(
                kind,
                path,
                store=self._store,
                engagement=engagement,
                created_by=self._role,
                source_episode_id=str(tool_call.get("id") or "auto-ingest"),
            )
            if "error" in outcome:
                log.debug("KG auto-ingest %s failed: %s", kind, outcome["error"])
