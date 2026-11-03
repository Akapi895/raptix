from __future__ import annotations

from types import SimpleNamespace

import pytest

from raptix.execution.tools.webshell.gates import WebShellRefused
from raptix.execution.tools.webshell.http_form import CURL_EXIT_MARKER, HTTP_STATUS_MARKER
from raptix.execution.tools.webshell.probe import execute_with, probe_with
from raptix.execution.tools.webshell.profile import WebShellProfile


class _Files:
    def __init__(self, files: dict[str, bytes] | None = None):
        self.files = files or {}

    def read_bytes(self, rel: str, *, max_bytes: int = 0) -> bytes | None:
        return self.files.get(rel)

    def exists(self, rel: str) -> bool:
        return rel in self.files


class _Sandbox:
    def __init__(self, output: str = "", exit_code: int = 0, error: Exception | None = None):
        self.output = output
        self.exit_code = exit_code
        self.error = error
        self.commands: list[tuple[str, int | None]] = []

    def execute(self, command: str, *, timeout: int | None = None):
        self.commands.append((command, timeout))
        if self.error is not None:
            raise self.error
        return SimpleNamespace(output=self.output, exit_code=self.exit_code, truncated=False)


def _profile(**overrides):
    data = {
        "provider": "http-form-command",
        "target": "10.129.88.4",
        "endpoint": "http://10.129.88.4/dev/phpbash.php",
        "method": "POST",
        "content_type": "application/x-www-form-urlencoded",
        "command_parameter": "cmd",
        "probe_command": "id;hostname",
        "probe_pattern": "uid=33",
        "expected_user": "www-data",
    }
    data.update(overrides)
    return WebShellProfile.model_validate(data)


def _daemon(body: str, status: int = 200, exit_code: int = 0) -> str:
    return f"{body}\n{HTTP_STATUS_MARKER}{status}\n{CURL_EXIT_MARKER}{exit_code}\n"


async def test_probe_reachable():
    sandbox = _Sandbox(_daemon("uid=33(www-data) gid=33(www-data)"))
    result = await probe_with(_Files(), sandbox, _profile())
    assert result["state"] == "reachable"
    assert result["matched"] is True
    assert result["http_status"] == 200
    assert "uid=33" in result["output"]
    assert sandbox.commands[0][1] == 30
    assert "--data-urlencode" in sandbox.commands[0][0]


async def test_probe_reachable_without_proof():
    sandbox = _Sandbox(_daemon("login page"))
    result = await probe_with(_Files(), sandbox, _profile())
    assert result["state"] == "reachable_no_proof"
    assert result["matched"] is False


async def test_probe_honors_abort_before_executing():
    sandbox = _Sandbox(_daemon("uid=33"))
    with pytest.raises(WebShellRefused):
        await probe_with(_Files({".abort": b""}), sandbox, _profile())
    assert sandbox.commands == []


async def test_probe_sandbox_failure_is_unknown():
    sandbox = _Sandbox(error=RuntimeError("daemon down"))
    result = await probe_with(_Files(), sandbox, _profile())
    assert result["state"] == "unknown"
    assert result["error"] == "sandbox_error: RuntimeError"


async def test_probe_sandbox_timeout_is_unknown():
    sandbox = _Sandbox(error=TimeoutError())
    result = await probe_with(_Files(), sandbox, _profile())
    assert result["state"] == "unknown"
    assert result["error"] == "sandbox_timeout"


async def test_execute_delivered():
    sandbox = _Sandbox(_daemon("PWNED"))
    result = await execute_with(_Files(), sandbox, _profile(), "whoami")
    assert result["state"] == "delivered"
    assert result["output"] == "PWNED"
    assert "cmd=whoami" in sandbox.commands[0][0]


async def test_execute_http_error_is_failed():
    sandbox = _Sandbox(_daemon("not found", status=404))
    result = await execute_with(_Files(), sandbox, _profile(), "whoami")
    assert result["state"] == "failed"
    assert result["http_status"] == 404


async def test_execute_network_failure_after_send_is_uncertain():
    sandbox = _Sandbox("curl: (56) Recv failure", exit_code=56)
    result = await execute_with(_Files(), sandbox, _profile(), "whoami")
    assert result["state"] == "uncertain"


async def test_execute_daemon_timeout_is_uncertain():
    sandbox = _Sandbox("Command timed out after 30s", exit_code=124)
    result = await execute_with(_Files(), sandbox, _profile(), "whoami")
    assert result["state"] == "uncertain"
