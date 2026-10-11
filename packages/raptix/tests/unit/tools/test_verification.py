from __future__ import annotations

import json

import pytest

from raptix.execution.tools.plumbing.verification import validate_workspace_finding


class _Sandbox:
    async def execute_tmux_async(self, *, command: str, **_kwargs: object) -> str:
        if command == "positive":
            return "proof-marker\n[Exit code: 0]"
        if command == "negative":
            return "ordinary response\n[Exit code: 0]"
        return "unexpected\n[Exit code: 1]"


@pytest.mark.asyncio
async def test_workspace_verifier_requires_and_records_negative_control(monkeypatch) -> None:
    monkeypatch.setattr("raptix.execution.tools.plumbing.verification.get_sandbox", _Sandbox)
    raw = await validate_workspace_finding.ainvoke(
        {
            "finding_id": "FIND-001",
            "poc_command": "positive",
            "success_patterns": "proof-marker",
            "negative_command": "negative",
            "negative_patterns": "ordinary response",
            "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        }
    )

    result = json.loads(raw)
    assert result["validated"] is True
    assert result["success_signals"] == ["proof-marker"]
    assert result["negative_signals"] == ["ordinary response"]


@pytest.mark.asyncio
async def test_workspace_verifier_rejects_missing_control_before_execution(monkeypatch) -> None:
    monkeypatch.setattr(
        "raptix.execution.tools.plumbing.verification.get_sandbox",
        lambda: (_ for _ in ()).throw(AssertionError("sandbox must not run")),
    )

    raw = await validate_workspace_finding.ainvoke(
        {
            "finding_id": "FIND-001",
            "poc_command": "positive",
            "success_patterns": "proof-marker",
            "negative_command": "",
            "negative_patterns": "ordinary response",
            "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        }
    )

    assert json.loads(raw)["error"] == "mandatory verification fields are missing"


async def test_workspace_verifier_routes_commands_to_run_sandbox(monkeypatch) -> None:
    from importlib import import_module

    bash_module = import_module("raptix.execution.tools.bash.bash")

    class RunSandbox(_Sandbox):
        async def execute_tmux_async(self, *, command: str, **kwargs: object) -> str:
            assert kwargs["workspace_path"] == "/workspace/acme"
            return await super().execute_tmux_async(command=command)

    remote = RunSandbox()
    monkeypatch.setattr(bash_module, "_sandbox_default", None)
    monkeypatch.setattr(
        "raptix.execution.backends.factory._shared_sandbox", lambda url, token: remote
    )
    result = json.loads(
        await validate_workspace_finding.ainvoke(
            {
                "finding_id": "FIND-001",
                "poc_command": "positive",
                "success_patterns": "proof-marker",
                "negative_command": "negative",
                "negative_patterns": "ordinary response",
                "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                "state": {"workspace_path": "/workspace/acme", "kg_engagement": "tenant-acme"},
            },
            config={
                "configurable": {
                    "sandbox_url": "http://run-sandbox",
                    "workspace_path": "/workspace/acme",
                }
            },
        )
    )
    assert result["validated"] is True


@pytest.mark.parametrize(
    "output",
    [
        "proof-marker\n[Exit code: 1]",
        "proof-marker\n[TIMEOUT] Command exceeded limit",
        "proof-marker\n[... 10 lines / 100 chars truncated — save full output ...]\n[Exit code: 0]",
        "proof-marker without completion status",
        "proof-marker\n[Exit code: 0]\n[Exit code: 1]",
        "proof-marker\n[Exit code: 1]\n[cwd: /workspace]",
        "proof-marker\n[Exit code: 0\n[session: poc — interactive, send next command with is_input=True]",
        "proof-marker\n[Exit code: 0\n[session: poc — hung, consider bash_kill]",
    ],
)
async def test_workspace_verifier_does_not_validate_incomplete_execution(
    monkeypatch, output
) -> None:
    class FailedProof(_Sandbox):
        async def execute_tmux_async(self, *, command: str, **kwargs: object) -> str:
            return (
                output
                if command == "positive"
                else await super().execute_tmux_async(command=command)
            )

    monkeypatch.setattr(
        "raptix.execution.tools.plumbing.verification.get_sandbox", lambda: FailedProof()
    )
    result = json.loads(
        await validate_workspace_finding.ainvoke(
            {
                "finding_id": "FIND-001",
                "poc_command": "positive",
                "success_patterns": "proof-marker",
                "negative_command": "negative",
                "negative_patterns": "ordinary response",
                "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
            }
        )
    )
    assert result["validated"] is False


async def test_workspace_verifier_accepts_native_tmux_success_footer(monkeypatch) -> None:
    class NativeOutput(_Sandbox):
        async def execute_tmux_async(self, *, command: str, **kwargs: object) -> str:
            return (
                "proof-marker" if command == "positive" else "ordinary response"
            ) + "\n[cwd: /workspace]"

    monkeypatch.setattr("raptix.execution.tools.plumbing.verification.get_sandbox", NativeOutput)
    result = json.loads(
        await validate_workspace_finding.ainvoke(
            {
                "finding_id": "FIND-001",
                "poc_command": "positive",
                "success_patterns": "proof-marker",
                "negative_command": "negative",
                "negative_patterns": "ordinary response",
                "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
            }
        )
    )
    assert result["validated"] is True


async def test_workspace_verifier_exit_diagnostics_use_final_footer(monkeypatch) -> None:
    class MisleadingOutput(_Sandbox):
        async def execute_tmux_async(self, *, command: str, **kwargs: object) -> str:
            if command == "positive":
                return "proof-marker\n[Exit code: 0]\n[Exit code: 1]\n[cwd: /workspace]"
            return await super().execute_tmux_async(command=command)

    monkeypatch.setattr(
        "raptix.execution.tools.plumbing.verification.get_sandbox", MisleadingOutput
    )
    result = json.loads(
        await validate_workspace_finding.ainvoke(
            {
                "finding_id": "FIND-001",
                "poc_command": "positive",
                "success_patterns": "proof-marker",
                "negative_command": "negative",
                "negative_patterns": "ordinary response",
                "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
            }
        )
    )
    assert (result["exit_code"], result["verification_execution"]["proof"]["exit_code"]) == (1, 1)
