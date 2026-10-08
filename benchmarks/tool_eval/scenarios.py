"""Scenario schema + strict JSONL loader — Wave T11.

A scenario pins one evaluable situation: the role, UKC phase, AKG
requirement answers, executor inventory, the tools the agent MUST
expose/select, the tools it must never expose/select, and (optionally)
deterministic executor cases driven through the real T7 adapter + T3
parser pipeline.

Scenarios are DATA, not code: the dev corpus
(``packages/raptix-core/tests/fixtures/capabilities/dev.jsonl``) is used
to tune tool schemas; the held-out corpus (``held-out.jsonl``, same
directory) is used for final evaluation only and must never tune
anything (plan T11 + AGENTS.md standing rule).

The loader is deliberately strict (``extra="forbid"`` + cross-field
validation + duplicate-id rejection): a scenario that silently drops a
typo'd field would produce silently wrong metrics — pre-registration
hygiene means the fixture set means exactly what it says.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

CORE_FIXTURES_DIR = (
    Path(__file__).parents[2] / "packages" / "raptix-core" / "tests" / "fixtures" / "capabilities"
)
DEV_FIXTURES = CORE_FIXTURES_DIR / "dev.jsonl"
HELD_OUT_FIXTURES = CORE_FIXTURES_DIR / "held-out.jsonl"

EXPECTATION_VALUES = frozenset({"eligible", "ineligible", "available", "unavailable"})


class ExecutorCase(BaseModel):
    """One deterministic capability → adapter → parser round trip."""

    model_config = ConfigDict(extra="forbid")

    case_id: str = Field(min_length=1)
    capability_id: str = Field(min_length=1)
    parameters: dict[str, Any] = Field(default_factory=dict)
    expected_argv_head: tuple[str, ...] = ()
    artifact_metadata: dict[str, str] = Field(default_factory=dict)
    content: str = ""
    expected_kinds: tuple[str, ...] = ()
    expect_parse_error: bool = False
    expect_resolution_error: bool = False


class Scenario(BaseModel):
    """One evaluable situation (see module docstring)."""

    model_config = ConfigDict(extra="forbid")

    scenario_id: str = Field(min_length=1)
    role: str = Field(min_length=1)
    phase: str | None = None
    mission: str = Field(min_length=1)
    graph_state: dict[str, bool] = Field(default_factory=dict)
    available_executors: tuple[str, ...] = ()
    required_tools: tuple[str, ...] = Field(min_length=1)
    forbidden_tools: tuple[str, ...] = ()
    optional_tools: tuple[str, ...] = ()
    expected_selection: tuple[str, ...] = ()
    capability_expectations: dict[str, str] = Field(default_factory=dict)
    executor_cases: tuple[ExecutorCase, ...] = ()

    @field_validator("capability_expectations")
    @classmethod
    def _expectation_values_known(cls, value: dict[str, str]) -> dict[str, str]:
        unknown = sorted(set(value.values()) - EXPECTATION_VALUES)
        if unknown:
            raise ValueError(
                f"unknown expectation values {unknown}; expected members of {sorted(EXPECTATION_VALUES)}"
            )
        return value

    def model_post_init(self, __context: Any) -> None:
        required = set(self.required_tools)
        for name, other in (
            ("forbidden_tools", self.forbidden_tools),
            ("optional_tools", self.optional_tools),
        ):
            overlap = sorted(required & set(other))
            if overlap:
                raise ValueError(
                    f"{self.scenario_id}: required_tools ∩ {name} = {overlap} — a tool "
                    "cannot be both required and forbidden/optional"
                )
        both = sorted(set(self.forbidden_tools) & set(self.optional_tools))
        if both:
            raise ValueError(f"{self.scenario_id}: forbidden_tools ∩ optional_tools = {both}")
        if self.expected_selection:
            clash = sorted(set(self.expected_selection) & set(self.forbidden_tools))
            if clash:
                raise ValueError(
                    f"{self.scenario_id}: expected_selection ∩ forbidden_tools = {clash}"
                )


def load_scenarios(path: str | Path) -> tuple[Scenario, ...]:
    """Load a JSONL scenario corpus, strictly.

    Rejects: blank lines, malformed JSON, duplicate scenario ids, and
    any schema/cross-field violation (pydantic ``extra="forbid"``).
    """
    file_path = Path(path)
    scenarios: list[Scenario] = []
    seen: set[str] = set()
    with file_path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, start=1):
            if not raw.strip():
                raise ValueError(f"{file_path}:{line_number}: blank line — JSONL corpora are dense")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as error:
                raise ValueError(f"{file_path}:{line_number}: invalid JSON ({error})") from error
            try:
                scenario = Scenario.model_validate(payload)
            except ValueError as error:
                raise ValueError(f"{file_path}:{line_number}: {error}") from error
            if scenario.scenario_id in seen:
                raise ValueError(
                    f"{file_path}:{line_number}: duplicate scenario_id {scenario.scenario_id!r}"
                )
            seen.add(scenario.scenario_id)
            scenarios.append(scenario)
    if not scenarios:
        raise ValueError(f"{file_path}: empty scenario corpus")
    return tuple(scenarios)
