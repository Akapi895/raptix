"""Regression guard: reporting tools must reach the agents that need them.

Historical context: ``REPORTING_TOOLS`` shipped and were unit-tested but
reached no agent (no agent listed them and ``build_tools`` never
received them), while ``contract_auditor.md`` instructed the model to
call ``report_hackerone`` — a tool the agent did not actually have, so
the model would emit a tool call that always fails. These tests pin the
wiring AND the prompt<->tool contract so the regression cannot return.

Current state (post Wave T5): ``REPORTING_TOOLS`` is the single
``generate_report(format)`` tool; the per-format renderers are plain
internal services. ``analyst`` remains the sole carrier of the
reporting surface (plus the three semantic reference lookups and
``inspect_evidence``) and is the only agent the prompt<->tool contract
check still applies to.
"""

from __future__ import annotations

from typing import Any

import pytest

from raptix.execution.tools.reporting.tools import REPORTING_TOOLS
from raptix.intelligence.agents.standard import analyst
from raptix.intelligence.prompts import load_prompt

_REPORTING_NAMES = frozenset(t.name for t in REPORTING_TOOLS)


def test_reporting_suite_is_nonempty() -> None:
    # Guards against the bundle being emptied out from under the wiring tests.
    assert {"generate_report"} <= _REPORTING_NAMES


def test_analyst_exposes_full_reporting_suite() -> None:
    """The Analyst is the engagement reporting specialist — it gets generate_report."""
    missing = _REPORTING_NAMES - frozenset(analyst._STANDARD_TOOLS)
    assert not missing, f"analyst is missing reporting tools: {sorted(missing)}"


@pytest.mark.parametrize(
    ("module", "role"),
    [
        (analyst, "analyst"),
    ],
)
def test_prompt_referenced_reporting_tools_are_wired(module: Any, role: str) -> None:
    """Any reporting tool a prompt tells the model to call MUST be in its toolset.

    A prompt that references a tool the agent cannot see makes the model
    emit a tool call that can never resolve — the exact bug this fixes.

    Only the analyst is checked: it is the sole agent that carries the
    reporting bundle. Other roles that previously referenced specific
    report_* tools (e.g. contract_auditor invoking report_hackerone in
    its prompt) have had those references rewritten to file-based
    equivalents.
    """
    prompt = load_prompt(role, shared=["bash"])
    toolset = frozenset(module._STANDARD_TOOLS)
    referenced = frozenset(name for name in _REPORTING_NAMES if name in prompt)
    missing = referenced - toolset
    assert not missing, f"{role}.md references unreachable reporting tools: {sorted(missing)}"
