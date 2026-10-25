"""Shared fixtures for the raptix runtime tests."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

import pytest

from raptix.execution.backends.project_files import ProjectFileUnavailable
from raptix.execution.session import instance_mailbox as mb

# The runtime API token gate (interfaces/api/auth.py) reads its token from this file. Route tests send the same token.
_RUNTIME_TEST_TOKEN = "test-runtime-token-0123456789abcdef"
_runtime_token_file = Path(tempfile.mkdtemp(prefix="raptix-runtime-token-")) / "runtime-api-token"
_runtime_token_file.write_text(_RUNTIME_TEST_TOKEN, encoding="utf-8")
os.environ["RAPTIX_RUNTIME_API_TOKEN_FILE"] = str(_runtime_token_file)


class LocalProjectFiles:
    """Stands in for a project's sandbox files, rooted at a folder on this machine.

    It answers the same calls as ``ProjectFiles`` with the same meaning. Set ``unavailable`` to make every call raise
    ``ProjectFileUnavailable``, as an unreachable sandbox does.
    """

    def __init__(self, root: Path, *, unavailable: bool = False) -> None:
        self.root = Path(root)
        self.unavailable = unavailable

    @property
    def key(self) -> str:
        return f"local:{self.root}"

    def _at(self, rel: str) -> Path:
        if self.unavailable:
            raise ProjectFileUnavailable("the project sandbox is not reachable")
        segments = rel.split("/")
        if (
            not rel
            or rel.startswith("/")
            or any(segment in ("", ".", "..") for segment in segments)
        ):
            raise ValueError(f"not a project-relative path: {rel!r}")
        return self.root.joinpath(*segments)

    def read_bytes(self, rel: str, *, max_bytes: int = 8 * 1024 * 1024) -> bytes | None:
        path = self._at(rel)
        if not path.is_file():
            return None
        data = path.read_bytes()
        if len(data) > max_bytes:
            raise ProjectFileUnavailable(f"{rel}: larger than {max_bytes} bytes")
        return data

    def read_last_line(self, rel: str) -> str | None:
        data = self.read_bytes(rel)
        if data is None:
            return None
        lines = [line for line in data.decode("utf-8").splitlines() if line.strip()]
        return lines[-1] if lines else None

    def exists(self, rel: str) -> bool:
        return self._at(rel).exists()

    def write_bytes(self, rel: str, data: bytes) -> None:
        path = self._at(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def append_bytes(self, rel: str, data: bytes) -> None:
        path = self._at(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("ab") as fh:
            fh.write(data)

    def list_dir(self, rel: str) -> list[tuple[str, bool]] | None:
        path = self._at(rel)
        if not path.is_dir():
            return None
        return sorted((child.name, child.is_dir()) for child in path.iterdir())

    def list_files(self, rel: str) -> list[str] | None:
        path = self._at(rel)
        if not path.is_dir():
            return None
        return sorted(
            child.relative_to(path).as_posix() for child in path.rglob("*") if child.is_file()
        )

    def file_digest(self, rel: str) -> tuple[str, int] | None:
        path = self._at(rel)
        if not path.is_file():
            return None
        data = path.read_bytes()
        return hashlib.sha256(data).hexdigest(), len(data)


@pytest.fixture
def project_files_at():
    """The project-files stand-in for a folder on disk: call it with the folder to get the files."""
    return LocalProjectFiles


@pytest.fixture(autouse=True)
def isolated_instance_mailbox(tmp_path, monkeypatch):
    """Each test gets its own operator mailbox, so attempt numbers never carry over between runs."""
    monkeypatch.setenv(mb.PATH_ENV, str(tmp_path / "instance_mailbox.sqlite"))
    monkeypatch.setattr(mb, "_default", None)
    yield
    if mb._default is not None:
        mb._default.close()
