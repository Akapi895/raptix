from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from raptix.execution.backends.project_files import ProjectFileUnavailable
from raptix.execution.tools.webshell.gates import WebShellRefused, check_request


class _Files:
    def __init__(self, files: dict[str, bytes] | None = None, *, fail: bool = False):
        self.files = files or {}
        self.fail = fail

    def read_bytes(self, rel: str, *, max_bytes: int = 0) -> bytes | None:
        if self.fail:
            raise ProjectFileUnavailable("sandbox unavailable")
        return self.files.get(rel)

    def exists(self, rel: str) -> bool:
        return rel in self.files


def _roe(**machine) -> _Files:
    data = {"machine_enforcement": {"mode": "enforce", **machine}}
    return _Files({"plan/roe.json": json.dumps(data).encode()})


def test_default_audit_roe_allows():
    check_request(_Files(), "10.129.88.4", "id")


def test_abort_marker_always_refuses():
    files = _Files({".abort": b""})
    with pytest.raises(WebShellRefused) as exc:
        check_request(files, "10.129.88.4", "id")
    assert exc.value.code == "agent_halted"


def test_unreadable_roe_refuses():
    with pytest.raises(WebShellRefused) as exc:
        check_request(_Files(fail=True), "10.129.88.4", "id")
    assert exc.value.code == "roe_unavailable"


def test_invalid_roe_refuses():
    files = _Files({"plan/roe.json": b"not json"})
    with pytest.raises(WebShellRefused) as exc:
        check_request(files, "10.129.88.4", "id")
    assert exc.value.code == "roe_unavailable"


def test_out_of_scope_target_refuses():
    files = _roe(in_scope=["10.129.88.4"])
    with pytest.raises(WebShellRefused) as exc:
        check_request(files, "10.129.88.5", "id")
    assert exc.value.code == "NOT_IN_SCOPE"


def test_command_target_refuses():
    files = _roe(in_scope=["10.129.88.4"])
    with pytest.raises(WebShellRefused) as exc:
        check_request(files, "10.129.88.4", "curl http://10.0.0.9/")
    assert exc.value.code == "NOT_IN_SCOPE"


def test_forbidden_command_refuses():
    files = _roe(in_scope=["10.129.88.4"], forbidden_command_patterns=["rm -rf"])
    with pytest.raises(WebShellRefused) as exc:
        check_request(files, "10.129.88.4", "rm -rf /tmp/x")
    assert exc.value.code == "FORBIDDEN_COMMAND"


def test_blackout_window_refuses():
    files = _roe(
        in_scope=["10.129.88.4"],
        blackout_windows=[
            {"start": "2020-01-01T00:00:00+00:00", "end": "2030-01-01T00:00:00+00:00"}
        ],
    )
    with pytest.raises(WebShellRefused) as exc:
        check_request(files, "10.129.88.4", "id", now=datetime(2026, 1, 1, tzinfo=UTC))
    assert exc.value.code == "BLACKOUT_WINDOW"


def test_authorized_window_outside_refuses():
    files = _roe(
        in_scope=["10.129.88.4"],
        authorized_windows=[
            {"start": "2020-01-01T00:00:00+00:00", "end": "2020-01-02T00:00:00+00:00"}
        ],
    )
    with pytest.raises(WebShellRefused) as exc:
        check_request(files, "10.129.88.4", "id", now=datetime(2026, 1, 1, tzinfo=UTC))
    assert exc.value.code == "OUTSIDE_TESTING_WINDOW"
