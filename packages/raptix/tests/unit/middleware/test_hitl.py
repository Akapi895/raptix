"""Tests for raptix.middleware.hitl."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import pytest
from langchain.tools import ToolRuntime
from langchain.tools.tool_node import ToolCallRequest
from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool

from raptix.execution.backends.project_files import ProjectFileUnavailable
from raptix.middleware import hitl as hitl_mod
from raptix.middleware.hitl import (
    ApprovalDecision,
    ApprovalPolicyRule,
    ApprovalRequest,
    FileBackedApprovalTransport,
    HITLApprovalMiddleware,
    InProcessApprovalTransport,
    ProjectApprovalTransport,
    _redact,
)


class _Tool:
    def __init__(self, name: str):
        self.name = name


class _Req:
    def __init__(self, tool_name: str, args: dict, state: dict | None = None):
        self.tool = _Tool(tool_name)
        self.tool_call_args = args
        self.tool_call_id = "tc_1"
        self.state = state or {}

    def override(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
        return self


def _allow_handler(request):
    return ToolMessage(
        content="executed",
        tool_call_id=request.tool_call_id,
        name=request.tool.name,
    )


def test_redact_strips_known_secret_keys():
    out = _redact({"username": "alice", "password": "p1", "api_key": "k", "x": 1})
    assert out["username"] == "alice"
    assert out["password"] == "***REDACTED***"
    assert out["api_key"] == "***REDACTED***"
    assert out["x"] == 1


@pytest.mark.asyncio
async def test_current_tool_request_retains_redacted_invocation_and_denial_identity():
    transport = InProcessApprovalTransport()
    middleware = HITLApprovalMiddleware(
        policy=[ApprovalPolicyRule(tool_pattern=r"^bash$", timeout_seconds=0)],
        transport=transport,
    )

    def printf(command: str) -> str:
        return command

    tool = StructuredTool.from_function(printf, name="bash", description="Local test output")
    runtime = ToolRuntime(
        state={},
        context=None,
        config={},
        stream_writer=lambda _: None,
        tool_call_id="modern-call",
        store=None,
    )
    request = ToolCallRequest(
        tool_call={
            "name": "bash",
            "args": {"command": "printf marker", "password": "PRIVATE"},
            "id": "modern-call",
            "type": "tool_call",
        },
        tool=tool,
        state={},
        runtime=runtime,
    )

    async def forbidden_handler(_request: ToolCallRequest) -> ToolMessage:
        raise AssertionError("An undecided tool must not execute")

    result = await middleware.awrap_tool_call(request, forbidden_handler)
    assert transport.pending()[0].tool_args_redacted == {
        "command": "printf marker",
        "password": "***REDACTED***",
    }
    assert result.tool_call_id == "modern-call"


def test_redirect_decision_applies_replacement_arguments_through_modern_tool_call():
    class RedirectTransport(InProcessApprovalTransport):
        def wait_for_decision(self, request_id: str, timeout: float) -> ApprovalDecision | None:
            return ApprovalDecision(
                request_id=request_id,
                action="redirect",
                redirect_args={"command": "printf safe"},
            )

    transport = RedirectTransport()
    middleware = HITLApprovalMiddleware(
        policy=[ApprovalPolicyRule(tool_pattern=r"^bash$", timeout_seconds=1)],
        transport=transport,
    )

    def printf(command: str) -> str:
        return command

    tool = StructuredTool.from_function(printf, name="bash", description="Local test output")
    runtime = ToolRuntime(
        state={},
        context=None,
        config={},
        stream_writer=lambda _: None,
        tool_call_id="redirect-call",
        store=None,
    )
    request = ToolCallRequest(
        tool_call={
            "name": "bash",
            "args": {"command": "printf original"},
            "id": "redirect-call",
            "type": "tool_call",
        },
        tool=tool,
        state={},
        runtime=runtime,
    )
    seen: dict[str, Any] = {}

    def handler(req):
        seen.update(req.tool_call["args"])
        return ToolMessage(content="executed", tool_call_id=req.tool_call["id"], name="bash")

    middleware.wrap_tool_call(request, handler)
    assert seen == {"command": "printf safe"}


def test_explicit_web_bash_approval_denies_on_timeout_without_changing_other_policies():
    class TimeoutTransport(InProcessApprovalTransport):
        def wait_for_decision(self, request_id: str, timeout: float) -> ApprovalDecision | None:
            return None

    policy = [ApprovalPolicyRule(tool_pattern=r"^bash$", default_on_timeout="allow")]
    transport = TimeoutTransport()
    middleware = HITLApprovalMiddleware(policy, transport, require_bash_approval=True)
    result = middleware.wrap_tool_call(_Req("bash", {"command": "printf marker"}), _allow_handler)
    assert result.status == "error"
    assert transport.pending()[0].matched_rule.default_on_timeout == "deny"
    unchanged = HITLApprovalMiddleware(policy, TimeoutTransport())
    assert unchanged.wrap_tool_call(_Req("bash", {}), _allow_handler).content == "executed"


def test_redact_recurses_into_nested():
    out = _redact({"outer": {"token": "x", "name": "y"}})
    assert out["outer"]["token"] == "***REDACTED***"
    assert out["outer"]["name"] == "y"


def test_inprocess_transport_roundtrip():
    t = InProcessApprovalTransport()
    req = ApprovalRequest(
        request_id="r1",
        engagement_name="e",
        agent_name="a",
        tool_name="bash",
        tool_args_redacted={},
        matched_rule=ApprovalPolicyRule(tool_pattern="bash"),
        reason="r",
        created_at=time.time(),
    )
    t.submit(req)
    assert len(t.pending()) == 1

    def _supply():
        time.sleep(0.05)
        t.provide_decision(ApprovalDecision(request_id="r1", action="allow"))

    threading.Thread(target=_supply, daemon=True).start()
    decision = t.wait_for_decision("r1", timeout=1.0)
    assert decision is not None
    assert decision.action == "allow"


def test_inprocess_transport_times_out_when_no_decision():
    t = InProcessApprovalTransport()
    req = ApprovalRequest(
        request_id="r2",
        engagement_name="",
        agent_name="",
        tool_name="bash",
        tool_args_redacted={},
        matched_rule=ApprovalPolicyRule(tool_pattern="bash"),
        reason="",
        created_at=time.time(),
    )
    t.submit(req)
    assert t.wait_for_decision("r2", timeout=0.2) is None


def test_filebacked_transport_roundtrip(tmp_path: Path):
    requests = tmp_path / "requests.jsonl"
    decisions = tmp_path / "decisions.jsonl"
    transport = FileBackedApprovalTransport(requests, decisions, poll_interval=0.05)
    req = ApprovalRequest(
        request_id="r3",
        engagement_name="eng",
        agent_name="recon",
        tool_name="bash",
        tool_args_redacted={"cmd": "id"},
        matched_rule=ApprovalPolicyRule(tool_pattern="bash"),
        reason="audit",
        created_at=time.time(),
    )
    transport.submit(req)
    assert "approval_request" in requests.read_text(encoding="utf-8")

    decisions.write_text(
        json.dumps(
            {
                "kind": "approval_decision",
                "request_id": "r3",
                "action": "allow",
                "operator_note": "looks fine",
                "decided_at": time.time(),
            }
        )
        + "\n",
        encoding="utf-8",
    )
    decision = transport.wait_for_decision("r3", timeout=2.0)
    assert decision is not None
    assert decision.action == "allow"
    assert decision.operator_note == "looks fine"


def test_filebacked_transport_returns_none_on_timeout(tmp_path: Path):
    transport = FileBackedApprovalTransport(
        tmp_path / "r.jsonl", tmp_path / "d.jsonl", poll_interval=0.05
    )
    transport.submit(
        ApprovalRequest(
            request_id="r4",
            engagement_name="",
            agent_name="",
            tool_name="bash",
            tool_args_redacted={},
            matched_rule=ApprovalPolicyRule(tool_pattern="bash"),
            reason="",
            created_at=time.time(),
        )
    )
    assert transport.wait_for_decision("r4", timeout=0.2) is None


def test_middleware_passes_through_unmatched_tools():
    t = InProcessApprovalTransport()
    mw = HITLApprovalMiddleware(
        policy=[ApprovalPolicyRule(tool_pattern=r"^dangerous_tool$")],
        transport=t,
    )
    request = _Req("safe_tool", {"x": 1})
    result = mw.wrap_tool_call(request, _allow_handler)
    assert result.content == "executed"
    assert t.pending() == []


def test_middleware_blocks_matched_tool_until_decision():
    t = InProcessApprovalTransport()
    mw = HITLApprovalMiddleware(
        policy=[ApprovalPolicyRule(tool_pattern=r"^dangerous$", timeout_seconds=2.0)],
        transport=t,
    )
    request = _Req("dangerous", {"target": "10.0.0.1"})

    def _approve():
        time.sleep(0.1)
        pending = t.pending()
        assert len(pending) == 1
        t.provide_decision(ApprovalDecision(request_id=pending[0].request_id, action="allow"))

    threading.Thread(target=_approve, daemon=True).start()
    result = mw.wrap_tool_call(request, _allow_handler)
    assert result.content == "executed"


def test_middleware_denies_on_timeout_by_default():
    t = InProcessApprovalTransport()
    mw = HITLApprovalMiddleware(
        policy=[
            ApprovalPolicyRule(
                tool_pattern=r"^dangerous$",
                timeout_seconds=0.15,
                default_on_timeout="deny",
            )
        ],
        transport=t,
    )
    request = _Req("dangerous", {})
    result = mw.wrap_tool_call(request, _allow_handler)
    assert isinstance(result, ToolMessage)
    assert result.status == "error"
    assert "denied" in result.content.lower()


def test_middleware_matches_by_technique_tag():
    t = InProcessApprovalTransport()
    mw = HITLApprovalMiddleware(
        policy=[ApprovalPolicyRule(technique_tag="T1003", timeout_seconds=0.2)],
        transport=t,
    )
    state = {"current_objective": {"technique_id": "T1003"}}
    request = _Req("any_tool", {}, state=state)

    threading.Thread(
        target=lambda: (
            time.sleep(0.05),
            t.provide_decision(
                ApprovalDecision(request_id=t.pending()[0].request_id, action="allow")
            ),
        ),
        daemon=True,
    ).start()
    result = mw.wrap_tool_call(request, _allow_handler)
    assert result.content == "executed"


def test_middleware_redacts_secrets_in_request_payload():
    t = InProcessApprovalTransport()
    mw = HITLApprovalMiddleware(
        policy=[ApprovalPolicyRule(tool_pattern=r"^dangerous$", timeout_seconds=0.15)],
        transport=t,
    )
    request = _Req("dangerous", {"username": "u", "password": "very-secret"})
    mw.wrap_tool_call(request, _allow_handler)
    pending = t.pending()
    assert pending
    args = pending[0].tool_args_redacted
    assert args["username"] == "u"
    assert args["password"] == "***REDACTED***"


@pytest.mark.asyncio
async def test_middleware_async_path_blocks_and_allows():
    t = InProcessApprovalTransport()
    mw = HITLApprovalMiddleware(
        policy=[ApprovalPolicyRule(tool_pattern=r"^dangerous$", timeout_seconds=2.0)],
        transport=t,
    )
    request = _Req("dangerous", {})

    async def _async_handler(req):
        return ToolMessage(content="async-ok", tool_call_id=req.tool_call_id, name=req.tool.name)

    def _approve():
        time.sleep(0.05)
        t.provide_decision(ApprovalDecision(request_id=t.pending()[0].request_id, action="allow"))

    threading.Thread(target=_approve, daemon=True).start()
    result = await mw.awrap_tool_call(request, _async_handler)
    assert result.content == "async-ok"


def test_default_high_impact_policy_includes_t1003_and_c2_deploy():
    from raptix.middleware.hitl import DEFAULT_HIGH_IMPACT_POLICY

    has_t1003 = any(r.technique_tag == "T1003" for r in DEFAULT_HIGH_IMPACT_POLICY)
    has_c2 = any(
        r.tool_pattern and "sliver_implant" in r.tool_pattern for r in DEFAULT_HIGH_IMPACT_POLICY
    )
    assert has_t1003
    assert has_c2


class _SleepingTransport:
    """Fake transport whose ``wait_for_decision`` blocks on ``time.sleep``
    before returning a decision — used to prove ``awrap_tool_call`` offloads
    the wait to a thread instead of freezing the event loop."""

    def __init__(self, sleep_for: float = 0.3) -> None:
        self._sleep_for = sleep_for
        self.submitted: list[ApprovalRequest] = []

    def submit(self, request: ApprovalRequest) -> None:
        self.submitted.append(request)

    def wait_for_decision(self, request_id: str, timeout: float) -> ApprovalDecision | None:
        time.sleep(self._sleep_for)  # blocking, like FileBackedApprovalTransport
        return ApprovalDecision(request_id=request_id, action="allow")


@pytest.mark.asyncio
async def test_awrap_does_not_block_event_loop():
    """``awrap_tool_call`` must offload the blocking ``wait_for_decision``
    to a worker thread (asyncio.to_thread) so the event loop keeps running."""
    import asyncio

    transport = _SleepingTransport(sleep_for=0.3)
    mw = HITLApprovalMiddleware(
        policy=[ApprovalPolicyRule(tool_pattern=r"^dangerous$", timeout_seconds=2.0)],
        transport=transport,
    )
    request = _Req("dangerous", {})

    async def _async_handler(req):
        return ToolMessage(content="async-ok", tool_call_id=req.tool_call_id, name=req.tool.name)

    ticks = 0

    async def _ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.02)
            ticks += 1

    ticker = asyncio.create_task(_ticker())
    result = await mw.awrap_tool_call(request, _async_handler)
    ticker.cancel()

    assert result.content == "async-ok"
    # If the loop had been frozen during the 0.3s blocking wait, the ticker
    # could not have advanced. Several ticks prove the loop stayed live.
    assert ticks >= 3


def test_resolve_transport_uses_static_when_set():
    t = InProcessApprovalTransport()
    mw = HITLApprovalMiddleware(policy=[], transport=t)
    assert mw._resolve_transport(_Req("x", {})) is t


@pytest.fixture
def project_on_disk(monkeypatch, project_files_at):
    """The approval transport reaches the project through its sandbox. A folder on disk stands in; tests choose it."""
    root = {"path": None}

    def files_for_runtime(_runtime):
        return project_files_at(root["path"])

    monkeypatch.setattr(hitl_mod, "project_files_for_runtime", files_for_runtime)
    return root


def test_resolve_transport_writes_approvals_into_the_project(
    tmp_path: Path, project_on_disk
) -> None:
    """With no static transport, approvals go to the project's own approvals folder, reached per request."""
    project_on_disk["path"] = tmp_path
    mw = HITLApprovalMiddleware(policy=[], transport=None)
    transport = mw._resolve_transport(_Req("x", {}))
    assert isinstance(transport, ProjectApprovalTransport)
    transport.submit(_approval_request("r-project"))
    assert "r-project" in (tmp_path / "approvals" / "requests.jsonl").read_text(encoding="utf-8")
    # Cached by project: the same project resolves to the same transport object.
    assert mw._resolve_transport(_Req("x", {})) is transport


def test_resolve_transport_distinct_per_project(tmp_path: Path, project_on_disk) -> None:
    """A long-lived server serving many projects gets a distinct transport per project."""
    mw = HITLApprovalMiddleware(policy=[], transport=None)
    project_on_disk["path"] = tmp_path / "eng-a"
    ta = mw._resolve_transport(_Req("x", {}))
    project_on_disk["path"] = tmp_path / "eng-b"
    tb = mw._resolve_transport(_Req("x", {}))
    assert ta is not tb
    ta.submit(_approval_request("r-a"))
    tb.submit(_approval_request("r-b"))
    assert "r-a" in (tmp_path / "eng-a" / "approvals" / "requests.jsonl").read_text(
        encoding="utf-8"
    )
    assert "r-b" in (tmp_path / "eng-b" / "approvals" / "requests.jsonl").read_text(
        encoding="utf-8"
    )


def test_resolve_transport_without_a_sandbox_endpoint_is_unavailable(monkeypatch) -> None:
    """No environment fallback: a run without its project sandbox cannot request an approval."""
    monkeypatch.setenv("RAPTIX_WORKSPACE_PATH", "/tmp/should-not-be-used")
    mw = HITLApprovalMiddleware(policy=[], transport=None)
    with pytest.raises(ProjectFileUnavailable):
        mw._resolve_transport(_Req("x", {}))


def test_project_transport_returns_the_decision_written_by_the_console(
    tmp_path: Path, project_files_at
) -> None:
    files = project_files_at(tmp_path)
    transport = ProjectApprovalTransport(files, poll_interval=0.01)
    transport.submit(_approval_request("r-decided"))
    (tmp_path / "approvals").mkdir(exist_ok=True)
    (tmp_path / "approvals" / "decisions.jsonl").write_text(
        json.dumps(
            {
                "kind": "approval_decision",
                "request_id": "r-decided",
                "action": "allow",
                "decided_at": 1.0,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    decision = transport.wait_for_decision("r-decided", timeout=2.0)
    assert decision is not None and decision.action == "allow"


def test_project_transport_refuses_when_the_sandbox_is_unreachable(
    tmp_path: Path, project_files_at
) -> None:
    files = project_files_at(tmp_path)
    files.unavailable = True
    transport = ProjectApprovalTransport(files, poll_interval=0.01)
    with pytest.raises(ProjectFileUnavailable):
        transport.submit(_approval_request("r-down"))


def _approval_request(request_id: str) -> ApprovalRequest:
    return ApprovalRequest(
        request_id=request_id,
        engagement_name="eng",
        agent_name="recon",
        tool_name="bash",
        tool_args_redacted={"cmd": "id"},
        matched_rule=ApprovalPolicyRule(tool_pattern="bash"),
        reason="audit",
        created_at=time.time(),
    )


class _RunRequest(_Req):
    def __init__(self, tool_name: str, args: dict, configurable: dict | None = None):
        super().__init__(tool_name, args)
        self.runtime = type("Runtime", (), {"config": {"configurable": configurable or {}}})()


class _NeverDecides(InProcessApprovalTransport):
    def wait_for_decision(self, request_id: str, timeout: float) -> ApprovalDecision | None:
        return None


def test_hitl_off_lets_ordinary_tools_run_without_approval():
    from raptix.middleware.hitl import DEFAULT_HIGH_IMPACT_POLICY

    transport = _NeverDecides()
    middleware = HITLApprovalMiddleware(DEFAULT_HIGH_IMPACT_POLICY, transport)
    result = middleware.wrap_tool_call(
        _RunRequest("sliver_implant_build", {}, {"hitl_enabled": False}), _allow_handler
    )
    assert result.content == "executed"
    assert transport.pending() == []


def test_hitl_off_still_requires_approval_for_dangerous_bash():
    from raptix.middleware.hitl import DEFAULT_HIGH_IMPACT_POLICY

    transport = _NeverDecides()
    middleware = HITLApprovalMiddleware(DEFAULT_HIGH_IMPACT_POLICY, transport)
    result = middleware.wrap_tool_call(
        _RunRequest(
            "bash",
            {"command": "hydra -l admin -P list.txt ssh://10.0.0.5"},
            {"hitl_enabled": False},
        ),
        _allow_handler,
    )
    assert result.status == "error"
    assert transport.pending()[0].matched_rule.dangerous


def test_hitl_defaults_to_on_when_the_run_carries_no_flag():
    from raptix.middleware.hitl import DEFAULT_HIGH_IMPACT_POLICY

    transport = _NeverDecides()
    middleware = HITLApprovalMiddleware(DEFAULT_HIGH_IMPACT_POLICY, transport)
    result = middleware.wrap_tool_call(_RunRequest("sliver_implant_build", {}), _allow_handler)
    assert result.status == "error"
    assert not transport.pending()[0].matched_rule.dangerous


def test_dangerous_command_patterns_match_only_the_listed_methods():
    middleware = HITLApprovalMiddleware([], InProcessApprovalTransport())
    for command in [
        "rm -rf /var/data",
        "hping3 --flood 10.0.0.5",
        "vssadmin delete shadows /all",
        "crontab -e",
        "setenforce 0",
    ]:
        rule = middleware._match_rule("bash", None, {"command": command}, hitl_enabled=False)
        assert rule is not None and rule.dangerous, command
    for command in ["ls -la /workspace", "nmap -sV 10.0.0.5", "cat plan/roe.json"]:
        assert (
            middleware._match_rule("bash", None, {"command": command}, hitl_enabled=False) is None
        ), command
