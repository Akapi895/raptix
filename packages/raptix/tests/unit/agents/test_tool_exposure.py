"""T0 baseline telemetry: tool-exposure summary + logging hook.

Pins two contracts from ``docs/tool-optimization-implementation-plan.md``
Wave T0:

  - ``summarize_tool_exposure`` is pure (no logging, no I/O) and reports
    only tool names/counts/schema-size — never a parameter value.
  - ``record_tool_exposure`` is a no-op unless ``RAPTIX_TOOL_TELEMETRY=1``,
    and never raises even when a tool is a bare object with no
    name/description/args_schema.
"""

from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import patch

from raptix.intelligence.agents import build as build_module
from raptix.intelligence.agents.tool_exposure import (
    record_tool_exposure,
    summarize_tool_exposure,
)
from raptix_core import plugin_loader


class _FakeSchema:
    def model_json_schema(self):
        return {"title": "Args", "properties": {"target": {"type": "string"}}}


def _fake_tool(name: str, description: str = "", schema: object | None = None):
    return SimpleNamespace(name=name, description=description, args_schema=schema)


def test_summarize_tool_exposure_counts_and_dedupes_names():
    tools = [_fake_tool("scan_network"), _fake_tool("scan_network"), _fake_tool("bash")]
    summary = summarize_tool_exposure("recon", tools)
    assert summary["role"] == "recon"
    assert summary["active_tools_per_turn"] == 2
    assert summary["tool_names"] == ["bash", "scan_network"]


def test_summarize_tool_exposure_never_includes_parameter_values():
    """Only schema shape (name/description/json-schema), never an arg value."""
    tool = _fake_tool("validate_credential", "check creds", _FakeSchema())
    summary = summarize_tool_exposure("exploit", [tool])
    assert summary["tool_schema_chars"] > 0
    assert "password" not in str(summary)  # no value ever passed in, none should appear


def test_summarize_tool_exposure_falls_back_to_dunder_name_for_bare_callables():
    def plain_fn():  # no .name attribute
        pass

    summary = summarize_tool_exposure("internal", [plain_fn])
    assert summary["tool_names"] == ["plain_fn"]


def test_record_tool_exposure_noop_without_env(monkeypatch, caplog):
    monkeypatch.delenv("RAPTIX_TOOL_TELEMETRY", raising=False)
    # ``raptix_core.utils.logging`` sets propagate=False on the "raptix"
    # root logger during import; caplog only sees records that reach the root.
    monkeypatch.setattr(logging.getLogger("raptix"), "propagate", True)
    with caplog.at_level(logging.INFO, logger="raptix.tools.exposure"):
        record_tool_exposure("recon", [_fake_tool("bash")])
    assert caplog.records == []


def test_record_tool_exposure_logs_when_enabled(monkeypatch, caplog):
    monkeypatch.setenv("RAPTIX_TOOL_TELEMETRY", "1")
    monkeypatch.setattr(logging.getLogger("raptix"), "propagate", True)
    with caplog.at_level(logging.INFO, logger="raptix.tools.exposure"):
        record_tool_exposure("recon", [_fake_tool("bash")])
    assert any("tool_exposure" in r.getMessage() for r in caplog.records)


def test_record_tool_exposure_never_raises_on_malformed_tool(monkeypatch):
    monkeypatch.setenv("RAPTIX_TOOL_TELEMETRY", "1")
    # A bare object with none of name/description/args_schema.
    record_tool_exposure("recon", [object()])


def test_build_tools_output_unchanged_regardless_of_telemetry_flag(monkeypatch):
    """No behavioral change: build_tools() returns the same list whether or
    not RAPTIX_TOOL_TELEMETRY is set."""
    baseline = {"a": _fake_tool("a"), "b": _fake_tool("b")}
    with patch.object(build_module, "entry_points", return_value=[]):
        with patch.object(plugin_loader, "entry_points", return_value=[]):
            monkeypatch.delenv("RAPTIX_TOOL_TELEMETRY", raising=False)
            without = build_module.build_tools(role="soundwave", standard_tools=baseline)
            monkeypatch.setenv("RAPTIX_TOOL_TELEMETRY", "1")
            with_telemetry = build_module.build_tools(role="soundwave", standard_tools=baseline)
    assert without == with_telemetry == [baseline["a"], baseline["b"]]
