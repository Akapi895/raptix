"""Project files, read and written through the project's own sandbox (ADR-0102).

A project's ``/workspace`` is a volume that only that project's sandbox mounts, so the runtime never sees a project
file directly. Each read and write (the RoE, the abort marker, the audit ledger) goes to the sandbox daemon the run is
routed to, with that project's token.

There is no process-wide fallback. A run without a sandbox endpoint has no project files at all, so every reader
fails closed. An unreachable sandbox, an unreadable file and a file over the bound all raise
:class:`ProjectFileUnavailable`. Only a file the daemon reports as absent means "nothing there".
"""

from __future__ import annotations

import contextvars
import posixpath
import shlex
import uuid
from collections.abc import Mapping
from typing import Any

import httpx
from deepagents.backends.protocol import FileDownloadResponse

from raptix.execution.backends.factory import _shared_sandbox
from raptix.execution.backends.http_sandbox import HTTPSandbox, SandboxError

WORKSPACE_ROOT = "/workspace"
# The daemon refuses a server-side bound above its own download cap (256 kB), so a larger read is sent unbounded and
# its length is checked here.
DAEMON_MAX_BYTES = 256_000
DEFAULT_READ_BYTES = 8 * 1024 * 1024
_COMMAND_TIMEOUT_SECONDS = 60
_FILE_NOT_FOUND = "file_not_found"
# The daemon reports these for a path that exists but is not a readable plain file, so the path is still present.
_PRESENT_ERRORS = frozenset({"file_too_large", "is_directory"})

_bound_endpoint: contextvars.ContextVar[tuple[str, str | None] | None] = contextvars.ContextVar(
    "raptix_project_endpoint", default=None
)


class ProjectFileUnavailable(RuntimeError):
    """A project file could not be read or written. The caller chooses the fail-closed outcome."""


def bind_project_endpoint(url: str | None, token: str | None) -> contextvars.Token | None:
    """Bind a run's sandbox endpoint for code that runs without the run's config (sub-agent tool calls)."""
    if not url:
        return None
    return _bound_endpoint.set((url, token))


def unbind_project_endpoint(token: contextvars.Token | None) -> None:
    if token is not None:
        _bound_endpoint.reset(token)


def project_sandbox_for(config: Any) -> HTTPSandbox:
    """The sandbox that holds this run's project files.

    The run's own ``configurable`` wins. A sub-agent's config does not carry the endpoint, so it falls back to the
    endpoint bound by the parent task node. With neither, the project is unreachable, and this raises.
    """
    configurable = config.get("configurable") if isinstance(config, Mapping) else None
    url = configurable.get("sandbox_url") if isinstance(configurable, Mapping) else None
    token = configurable.get("sandbox_token") if isinstance(configurable, Mapping) else None
    if not (isinstance(url, str) and url):
        bound = _bound_endpoint.get()
        if bound is None:
            raise ProjectFileUnavailable("no project sandbox is bound to this run")
        url, token = bound
    return _shared_sandbox(url, token if isinstance(token, str) and token else None)


def project_files_for(config: Any) -> ProjectFiles:
    return ProjectFiles(project_sandbox_for(config))


def ambient_project_files() -> ProjectFiles:
    """The project files for code that receives no config: the running graph's config, else the bound endpoint."""
    try:
        from langgraph.config import get_config

        config = get_config()
    except RuntimeError:
        config = None
    return project_files_for(config)


def project_files_for_runtime(runtime: Any) -> ProjectFiles:
    """The project files for a middleware or tool call, from its runtime's config when that carries the run."""
    config = getattr(runtime, "config", None)
    if config is None:
        return ambient_project_files()
    return project_files_for(config)


def _project_path(root: str, rel: str) -> str:
    segments = rel.split("/")
    if not rel or rel.startswith("/") or any(segment in ("", ".", "..") for segment in segments):
        raise ValueError(f"not a project-relative path: {rel!r}")
    return f"{root}/{rel}"


class ProjectFiles:
    """The files of one project, reached through its sandbox daemon."""

    def __init__(self, sandbox: HTTPSandbox, *, root: str = WORKSPACE_ROOT) -> None:
        self._sandbox = sandbox
        self._root = root

    @property
    def key(self) -> str:
        """Identifies the project for caches: one sandbox serves one project."""
        return f"{self._sandbox.id}|{self._root}"

    def read_bytes(self, rel: str, *, max_bytes: int = DEFAULT_READ_BYTES) -> bytes | None:
        """The file's bytes, or None when the file does not exist. A file longer than ``max_bytes`` is unavailable."""
        bound = max_bytes if max_bytes <= DAEMON_MAX_BYTES else None
        result = self._download(rel, max_bytes=bound)
        if result.error == _FILE_NOT_FOUND:
            return None
        if result.error is not None or result.content is None:
            raise ProjectFileUnavailable(f"{rel}: {result.error or 'no content returned'}")
        if len(result.content) > max_bytes:
            raise ProjectFileUnavailable(f"{rel}: larger than {max_bytes} bytes")
        return result.content

    def read_last_line(self, rel: str) -> str | None:
        """The file's last line, or None when the file does not exist or is empty. Reads from the end, so size is free."""
        target = _project_path(self._root, rel)
        command = f"if [ -f {shlex.quote(target)} ]; then tail -n 1 -- {shlex.quote(target)}; fi"
        try:
            response = self._sandbox.execute(command, timeout=_COMMAND_TIMEOUT_SECONDS)
        except (SandboxError, httpx.HTTPError) as exc:
            raise ProjectFileUnavailable(f"{rel}: tail failed") from exc
        if response.exit_code != 0:
            raise ProjectFileUnavailable(f"{rel}: tail exited with {response.exit_code}")
        line = response.output.strip()
        return line or None

    def exists(self, rel: str) -> bool:
        """Whether anything exists at the path. Probes with no bytes, so a large file costs nothing to check."""
        result = self._download(rel, max_bytes=0)
        if result.error == _FILE_NOT_FOUND:
            return False
        if result.error is None or result.error in _PRESENT_ERRORS:
            return True
        raise ProjectFileUnavailable(f"{rel}: {result.error}")

    def write_bytes(self, rel: str, data: bytes) -> None:
        """Creates or replaces the file. The daemon creates the parent directories."""
        target = _project_path(self._root, rel)
        try:
            results = self._sandbox.upload_files([(target, data)])
        except (SandboxError, httpx.HTTPError) as exc:
            raise ProjectFileUnavailable(f"{rel}: upload failed") from exc
        if len(results) != 1 or results[0].error is not None:
            raise ProjectFileUnavailable(f"{rel}: upload was refused")

    def append_bytes(self, rel: str, data: bytes) -> None:
        """Appends to the file, creating it when needed. The bytes travel as a staged upload, never inside a command."""
        target = _project_path(self._root, rel)
        staging = f"{posixpath.dirname(target)}/.append-{uuid.uuid4().hex}.tmp"
        try:
            staged = self._sandbox.upload_files([(staging, data)])
            if len(staged) != 1 or staged[0].error is not None:
                raise ProjectFileUnavailable(f"{rel}: staging upload was refused")
            command = (
                f"cat -- {shlex.quote(staging)} >> {shlex.quote(target)}; status=$?; "
                f"rm -f -- {shlex.quote(staging)}; exit $status"
            )
            response = self._sandbox.execute(command, timeout=_COMMAND_TIMEOUT_SECONDS)
        except (SandboxError, httpx.HTTPError) as exc:
            raise ProjectFileUnavailable(f"{rel}: append failed") from exc
        if response.exit_code != 0:
            raise ProjectFileUnavailable(f"{rel}: append exited with {response.exit_code}")

    def list_dir(self, rel: str) -> list[tuple[str, bool]] | None:
        """The directory's entries as (name, is_directory), or None when the path is not a directory."""
        quoted = shlex.quote(_project_path(self._root, rel))
        command = (
            f"if [ -d {quoted} ]; then find {quoted} -mindepth 1 -maxdepth 1 -printf '%y %f\\n'; "
            "else echo __absent__; fi"
        )
        try:
            response = self._sandbox.execute(command, timeout=_COMMAND_TIMEOUT_SECONDS)
        except (SandboxError, httpx.HTTPError) as exc:
            raise ProjectFileUnavailable(f"{rel}: listing failed") from exc
        if response.exit_code != 0:
            raise ProjectFileUnavailable(f"{rel}: listing exited with {response.exit_code}")
        if response.output.strip() == "__absent__":
            return None
        entries: list[tuple[str, bool]] = []
        for line in response.output.splitlines():
            kind, _, name = line.partition(" ")
            if name:
                entries.append((name, kind == "d"))
        return entries

    def list_files(self, rel: str) -> list[str] | None:
        """Every regular file under the directory, relative to it and sorted, or None when it is not a directory."""
        quoted = shlex.quote(_project_path(self._root, rel))
        command = f"if [ -d {quoted} ]; then cd {quoted} && find . -type f -printf '%P\\n' | sort; else echo __absent__; fi"
        try:
            response = self._sandbox.execute(command, timeout=_COMMAND_TIMEOUT_SECONDS)
        except (SandboxError, httpx.HTTPError) as exc:
            raise ProjectFileUnavailable(f"{rel}: listing failed") from exc
        if response.exit_code != 0:
            raise ProjectFileUnavailable(f"{rel}: listing exited with {response.exit_code}")
        if response.output.strip() == "__absent__":
            return None
        return [name for name in response.output.splitlines() if name]

    def file_digest(self, rel: str) -> tuple[str, int] | None:
        """The SHA-256 and byte size of a regular file, computed inside the sandbox, or None when there is no such file."""
        quoted = shlex.quote(_project_path(self._root, rel))
        command = (
            f"if [ -f {quoted} ]; then sha256sum -- {quoted} | cut -c1-64; stat -c %s -- {quoted}; "
            "else echo __absent__; fi"
        )
        try:
            response = self._sandbox.execute(command, timeout=_COMMAND_TIMEOUT_SECONDS)
        except (SandboxError, httpx.HTTPError) as exc:
            raise ProjectFileUnavailable(f"{rel}: digest failed") from exc
        if response.exit_code != 0:
            raise ProjectFileUnavailable(f"{rel}: digest exited with {response.exit_code}")
        lines = response.output.split()
        if lines == ["__absent__"]:
            return None
        if len(lines) != 2 or len(lines[0]) != 64 or not lines[1].isdigit():
            raise ProjectFileUnavailable(f"{rel}: unexpected digest output")
        return lines[0], int(lines[1])

    def _download(self, rel: str, *, max_bytes: int) -> FileDownloadResponse:
        target = _project_path(self._root, rel)
        try:
            results = self._sandbox.download_files([target], max_bytes=max_bytes)
        except (SandboxError, httpx.HTTPError) as exc:
            raise ProjectFileUnavailable(f"{rel}: download failed") from exc
        if len(results) != 1:
            raise ProjectFileUnavailable(f"{rel}: unexpected download response")
        return results[0]
