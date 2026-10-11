"""Ingest bounded scanner output after a successful bash tool call.

Two parse paths, both LLM-free:

  * ``_SCANNERS`` kinds (nmap/httpx/nuclei/katana/arjun) keep the
    pre-T3 ``knowledge.graph.ingest`` adapter path — their adapters
    carry richer graph semantics (technology detection, endpoint /
    parameter extraction) that the tool-layer parsers do not reproduce.
  * ``_REGISTRY_SCANNERS`` kinds (subfinder/dnsx/ffuf/masscan/gobuster)
    resolve through the Wave T3 ``knowledge.ingest`` ParserRegistry —
    the new canonical parse path that T4+ consolidates the adapters
    into. ``gobuster`` additionally needs its ``-u <base_url>`` flag
    extracted into the artifact's metadata (``GobusterParser`` cannot
    otherwise anchor hits to a host — its text output carries no origin
    of its own).

Not every former ``kg_ingest_*`` format is auto-ingested. sarif, slither,
testssl, crackmapexec, and asrep_hashes are conventionally invoked with
output redirected to a file (``> out.txt`` / piped) rather than a single
predictable output flag, and this middleware deliberately refuses to
parse a command containing shell redirection (``_output`` rejects
``>``/``<``/pipes outright) — there is no safe way to auto-detect their
output path yet, so they stay explicit ``@tool`` calls
(``execution/tools/research/tools.py``).
"""

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
from raptix.knowledge.ingest import default_registry
from raptix.knowledge.ingest.materialize import observations_to_records
from raptix.middleware.filesystem import _normalize_engagement_workspace
from raptix_core.types.capability import Artifact

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
_REGISTRY_SCANNERS = {
    "subfinder": "-o",
    "dnsx": "-o",
    "ffuf": "-o",
    "masscan": "-oJ",
    "gobuster": "-o",
}


def _capture_enabled() -> bool:
    return os.environ.get("RAPTIX_KG_EVIDENCE_CAPTURE", "0").lower() in {"1", "true", "yes"}


class _CaptureStore:
    """Delegate a store, stamping one capture reference onto every node written.

    The legacy adapter path builds its observation dicts and writes them itself,
    so a thin wrapper keeps adapters unchanged while giving every node the same
    ``source_artifact_ref`` for the one scan that produced it.
    """

    def __init__(self, store: Any, extra_props: dict[str, Any]) -> None:
        self._store = store
        self._extra = extra_props

    def record_observations(self, observations: Any, **scope: Any) -> Any:
        for observation in observations:
            if not isinstance(observation, dict):
                continue
            props = observation.setdefault("props", {})
            if isinstance(props, dict):
                for key, value in self._extra.items():
                    props.setdefault(key, value)
        return self._store.record_observations(observations, **scope)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._store, name)


def _flag_value(args: list[str], flag: str) -> str | None:
    """Value immediately following the first (and only) occurrence of
    ``flag`` in ``args``, or ``None`` if it's absent or ambiguous."""
    if args.count(flag) != 1:
        return None
    index = args.index(flag) + 1
    return args[index] if index < len(args) else None


def _output(command: str) -> tuple[str, str] | None:
    try:
        args = shlex.split(command)
    except ValueError:
        return None
    if not args or any(part in {";", "&&", "||", "|", ">", "<"} for part in args):
        return None
    binary = posixpath.basename(args[0])
    kind: str | None = None
    output_flag = ""
    if binary in _SCANNERS:
        kind, output_flag = _SCANNERS[binary]
    elif binary in _REGISTRY_SCANNERS:
        kind = binary
        output_flag = _REGISTRY_SCANNERS[binary]
    if kind is None:
        return None
    if binary == "httpx" and "-json" not in args:
        return None
    if binary == "nuclei" and not any(flag in args for flag in ("-jsonl", "-json")):
        return None
    if binary == "katana" and "-jsonl" not in args:
        return None
    if binary == "arjun" and "-oJ" not in args:
        return None
    if binary == "gobuster" and _flag_value(args, "-u") is None:
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
        sandbox = self._sandbox
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
            runtime = getattr(request, "runtime", None)
            if runtime is not None and getattr(runtime, "config", None):
                from raptix.execution.backends.factory import build_sandbox_backend

                sandbox = build_sandbox_backend(runtime.config)
            entries = sandbox.ls_info(posixpath.dirname(output_path))
            file_info = next((entry for entry in entries if entry.get("path") == output_path), None)
            size = file_info.get("size") if file_info is not None else None
            if not isinstance(size, int):
                return
            if size > _MAX_BYTES:
                return
            downloaded = (
                sandbox.download_files(
                    [output_path], workspace_path=workspace, max_bytes=_MAX_BYTES
                )
                if _capture_enabled()
                else sandbox.download_files([output_path])
            )
            if len(downloaded) != 1 or downloaded[0].error:
                return
            content = downloaded[0].content
        if not content or len(content) > _MAX_BYTES:
            return
        episode_id = str(tool_call.get("id") or "auto-ingest")
        if kind in _REGISTRY_SCANNERS:
            metadata: dict[str, Any] = {}
            if kind == "gobuster":
                base_url = _flag_value(shlex.split(command), "-u")
                if not base_url:
                    return
                metadata["base_url"] = base_url
            self._ingest_via_registry(
                kind,
                content,
                engagement,
                episode_id,
                metadata=metadata,
                sandbox=sandbox,
                workspace=workspace,
            )
            return
        store: Any = self._store
        if _capture_enabled():
            from raptix.execution.tools.evidence.artifacts import retain_artifact

            try:
                retained = retain_artifact(
                    Artifact(
                        id=episode_id,
                        artifact_ref=f"episode://{episode_id}/{kind}",
                        format_hint=kind,
                        producer=self._role,
                    ),
                    content,
                    sandbox=sandbox,
                    workspace=workspace,
                    engagement=engagement,
                )
            except Exception as exc:  # noqa: BLE001 — retention failure preserves baseline ingestion
                log.debug("Scanner capture unavailable (%s)", type(exc).__name__)
            else:
                # Legacy adapters use their own node identity, so the capture is
                # retained for integrity/traceability but not source-assessed.
                store = _CaptureStore(
                    self._store,
                    {
                        "source_artifact_ref": retained.artifact_ref,
                        "source_artifact_id": retained.id,
                    },
                )
        with tempfile.TemporaryDirectory(prefix="raptix-kg-") as directory:
            path = Path(directory) / "scan"
            path.write_bytes(content)
            outcome = ingest(
                kind,
                path,
                store=store,
                engagement=engagement,
                created_by=self._role,
                source_episode_id=episode_id,
            )
            if "error" in outcome:
                log.debug("KG auto-ingest %s failed: %s", kind, outcome["error"])

    def _ingest_via_registry(
        self,
        kind: str,
        content: bytes,
        engagement: str,
        episode_id: str,
        *,
        metadata: dict[str, Any] | None = None,
        sandbox: Any = None,
        workspace: str | None = None,
    ) -> None:
        """Parse through the T3 ParserRegistry and record the observations.

        ``kind`` is the command-derived expected format; sniffing only runs
        if the registry ever loses the explicit kind. Failures are logged
        at debug and never re-raised — the tool result is already returned.
        ``metadata`` carries per-format context the content itself doesn't
        — e.g. gobuster's ``base_url``, extracted from the command's
        ``-u`` flag (its text output has no origin of its own).
        """
        artifact = Artifact(
            id=episode_id,
            artifact_ref=f"episode://{episode_id}/{posixpath.basename(kind)}",
            format_hint=kind,
            producer=self._role,
            metadata=metadata or {},
        )
        try:
            outcome = default_registry().parse(artifact, content, expected_formats=(kind,))
            records = observations_to_records(outcome.observations)
            if not records:
                return
            if _capture_enabled() and sandbox is not None and workspace is not None:
                from raptix.execution.tools.evidence.artifacts import retain_artifact

                try:
                    retained = retain_artifact(
                        artifact,
                        content,
                        sandbox=sandbox,
                        workspace=workspace,
                        engagement=engagement,
                        parser_id=outcome.format_id,
                        parser_version=outcome.parser_version,
                    )
                except Exception as exc:  # noqa: BLE001 — retention failure preserves baseline ingestion
                    log.debug("Scanner capture unavailable (%s)", type(exc).__name__)
                else:
                    for record in records:
                        record["props"]["source_artifact_ref"] = retained.artifact_ref
            self._store.record_observations(
                records,
                engagement=engagement,
                created_by=self._role,
                source_episode_id=episode_id,
            )
        except Exception as exc:
            log.debug("KG auto-ingest %s parse failed: %s", kind, exc)
