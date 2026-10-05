"""Opt-in graph projection must be scoped, bounded and never claim liveness."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from langchain_core.messages import SystemMessage

from raptix.knowledge.graph.operational_state import MAX_BLOCK, build_operational_state
from raptix.knowledge.graph.store import KGStore
from raptix.middleware.kg import KGMiddleware


def test_projection_bounds_untrusted_fields_and_does_not_echo_credential_labels() -> None:
    store = MagicMock(spec=KGStore)
    store.execute_read.side_effect = [
        [{"source": "WS01", "target": "A" * 200000, "provenance": "bloodhound"}],
        [{"source": "password=secret-123456", "provenance": "scanner"}],
        [],
    ]
    rendered = build_operational_state(store, engagement="lab")
    assert len(rendered) <= MAX_BLOCK
    assert "password=secret-123456" not in rendered
    assert "NOT a live managed session" in rendered
    assert 'verified": "false' in rendered
    for call in store.execute_read.call_args_list:
        assert call.kwargs["engagement"] == "lab"
        assert "$engagement" in call.args[0]
        assert call.args[1]["limit"] == 5


def test_projection_is_off_by_default_and_only_injected_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = MagicMock(spec=KGStore)
    store.revision.return_value = "rev-lab-1"
    store.execute_read.side_effect = [[{"source": "WS01", "target": "user1"}], [], []]
    monkeypatch.setattr(
        "raptix.middleware.kg.build_summary", lambda store, *, engagement: "summary"
    )
    off = KGMiddleware(store=store)
    off_state = off.before_agent({"engagement_name": "lab"}, None)
    assert off_state is not None and "kg_operational_state" not in off_state
    store.execute_read.assert_not_called()

    enabled = KGMiddleware(store=store, operational_shadow=True)
    live_state = enabled.before_agent({"engagement_name": "lab"}, None)
    assert live_state is not None and "OPERATIONAL STATE" in live_state["kg_operational_state"]
    request = MagicMock()
    request.state = live_state
    request.system_message = SystemMessage(content="base")
    request.override.side_effect = lambda **changes: changes
    output = enabled.wrap_model_call(request, lambda changed: changed)
    assert output["system_message"].content_blocks[-1]["text"].find("OPERATIONAL STATE") >= 0


def test_projection_failure_preserves_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    store = MagicMock(spec=KGStore)
    store.revision.return_value = "rev-lab-2"
    store.execute_read.side_effect = RuntimeError("temporarily unavailable")
    monkeypatch.setattr(
        "raptix.middleware.kg.build_summary", lambda store, *, engagement: "still there"
    )
    result = KGMiddleware(store=store, operational_shadow=True).before_agent(
        {"engagement_name": "lab"}, None
    )
    assert result is not None
    assert result["kg_summary"] == "still there"
    assert result["kg_operational_state"] == ""
