"""Provenance acceptance depends on consumed sources, never golden answers."""

import json
from typing import Any

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage

from benchmarks.engine.paths import BENCHMARKS_DIR
from benchmarks.suites.decision_eval.evaluate import load_scenarios, run_episode
from benchmarks.suites.decision_eval.provenance import audit_provenance

REF_A = "workspace-evidence://" + "a" * 64
REF_B = "workspace-evidence://" + "b" * 64


class ReplayModel(FakeMessagesListChatModel):
    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        return self


@pytest.mark.parametrize(
    ("refs", "lineage", "observations", "issue"),
    [
        (["FIND-1"], 1, {"FIND-1": {"outcome": "inconclusive"}}, "unknown_reference"),
        (
            [REF_A[:-1]],
            1,
            {"FIND-1": {"reference": REF_A, "invocation_id": "run-1"}},
            "invalid_reference",
        ),
        ([REF_A], 1, {}, "claim_reads_incomplete"),
        (
            [REF_B],
            1,
            {"FIND-1": {"reference": REF_A, "invocation_id": "run-1"}},
            "unknown_reference",
        ),
        (
            [REF_A, REF_A],
            1,
            {"FIND-1": {"reference": REF_A, "invocation_id": "run-1"}},
            "duplicate_reference",
        ),
        (
            [REF_A],
            2,
            {"FIND-1": {"reference": REF_A, "invocation_id": "run-1"}},
            "lineage_mismatch",
        ),
        ([], 1, {"FIND-1": {"outcome": "inconclusive"}}, "lineage_mismatch"),
        ([REF_A], 0, {"FIND-1": {"reference": REF_A}}, "missing_producer_invocation"),
        (
            [REF_A],
            1,
            {"FIND-1": {"reference": REF_A, "invocation_id": "", "outcome": "supported"}},
            "missing_producer_invocation",
        ),
        (
            [REF_A],
            1,
            {
                "FIND-1": {
                    "reference": REF_A,
                    "invocation_id": "run-1",
                    "reason": "finding_binding_mismatch",
                }
            },
            "unknown_reference",
        ),
        (
            [REF_A],
            1,
            {"FIND-1": {"reference": REF_A, "invocation_id": "run-1", "error": "unavailable"}},
            "unknown_reference",
        ),
        ([], 0, {"OUTSIDE": {"error": "outside_replay_scope"}}, "outside_replay_scope"),
        (
            [REF_A],
            1,
            {
                "FIND-1": {"outcome": "inconclusive"},
                "OTHER": {"reference": REF_A, "invocation_id": "other-run"},
            },
            "unknown_reference",
        ),
    ],
)
def test_provenance_rejects_unbound_or_inconsistent_citations(
    refs: list[str], lineage: int, observations: dict[str, dict[str, Any]], issue: str
) -> None:
    audit = audit_provenance(
        evidence_refs=refs,
        lineage_count=lineage,
        claim_replays={"FIND-1"},
        declared_replays={"FIND-1", "OTHER"},
        observations=observations,
    )
    assert audit["accepted"] is False
    assert issue in audit["issues"]


@pytest.mark.parametrize(
    "references,invocations,lineage",
    [
        ([REF_A, REF_A], ["run-1", "run-1"], 1),
        ([REF_A, REF_B], ["run-1", "run-1"], 1),
        ([REF_A, REF_B], ["run-1", "run-2"], 2),
    ],
)
def test_producer_lineage_counts_invocations_instead_of_reads_or_references(
    references: list[str], invocations: list[str], lineage: int
) -> None:
    observations = {
        str(i): {"reference": ref, "invocation_id": invocation}
        for i, (ref, invocation) in enumerate(zip(references, invocations, strict=True))
    }
    audit = audit_provenance(
        evidence_refs=list(dict.fromkeys(references)),
        lineage_count=lineage,
        claim_replays=set(observations),
        declared_replays=set(observations),
        observations=observations,
    )
    assert audit == {"accepted": True, "issues": [], "derived_lineage_count": lineage}


def test_same_verification_reference_cannot_have_conflicting_producers() -> None:
    observations = {
        "A": {"reference": REF_A, "invocation_id": "run-1"},
        "B": {"reference": REF_A, "invocation_id": "run-2"},
    }
    audit = audit_provenance(
        evidence_refs=[REF_A],
        lineage_count=2,
        claim_replays={"A", "B"},
        declared_replays={"A", "B"},
        observations=observations,
    )
    assert audit["accepted"] is False
    assert "conflicting_reference" in audit["issues"]
    assert audit["derived_lineage_count"] is None


def test_no_reference_means_zero_lineages_not_one_successful_read() -> None:
    audit = audit_provenance(
        evidence_refs=[],
        lineage_count=0,
        claim_replays={"A"},
        declared_replays={"A"},
        observations={"A": {"outcome": "inconclusive", "error": "record_missing"}},
    )
    assert audit == {"accepted": True, "issues": [], "derived_lineage_count": 0}


def test_untrusted_source_reason_type_cannot_bypass_binding_failure_checks() -> None:
    audit = audit_provenance(
        evidence_refs=[REF_A],
        lineage_count=1,
        claim_replays={"A"},
        declared_replays={"A"},
        observations={
            "A": {
                "reference": REF_A,
                "invocation_id": "run-1",
                "reason": ["finding_binding_mismatch"],
            }
        },
    )
    assert audit["accepted"] is False
    assert "invalid_source_metadata" in audit["issues"]


@pytest.mark.parametrize(
    "extra,issue",
    [
        ({"requires_evidence": True}, "missing_evidence"),
        ({"forbidden_tools": ["bash"]}, "forbidden_tool_attempt"),
        ({"episode_error": "TimeoutError"}, "episode_failed"),
    ],
)
def test_boundary_cannot_accept_missing_evidence_or_failed_execution(
    extra: dict[str, Any], issue: str
) -> None:
    audit = audit_provenance(
        evidence_refs=[],
        lineage_count=0,
        claim_replays={"A"},
        declared_replays={"A"},
        observations={"A": {"outcome": "inconclusive"}},
        **extra,
    )
    assert audit["accepted"] is False
    assert issue in audit["issues"]


@pytest.mark.asyncio
async def test_runtime_ledger_is_captured_when_tool_returns_not_from_later_fixture_state() -> None:
    case = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    answer = {
        "outcome": "supported",
        "next_action": "report_scoped",
        "evidence_refs": [REF_A],
        "lineage_count": 1,
    }

    class MutatingProvider(ReplayModel):
        async def _agenerate(self, *args: Any, **kwargs: Any) -> Any:
            if self.i == 1:
                case.replays["FIND-001"]["reference"] = REF_B
                case.replays["FIND-001"]["invocation_id"] = "later-run"
            return await super()._agenerate(*args, **kwargs)

    model = MutatingProvider(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "read_replayed_verification",
                        "id": "read-1",
                        "args": {"finding_id": "FIND-001"},
                    }
                ],
            ),
            AIMessage(content=json.dumps(answer)),
        ]
    )
    row = await run_episode(case, model, "baseline", timeout=5)
    assert row["bound_decision"] == answer
    assert row["observations"]["FIND-001"]["reference"] == REF_A
    assert row["observations"]["FIND-001"]["invocation_id"] == "run-001"


@pytest.mark.asyncio
async def test_binding_ignores_golden_answers_and_preserves_wrong_semantic_scores() -> None:
    case = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    case.expected.outcome = "contradicted"
    case.expected.accepted_actions = ["revise_hypothesis"]
    answer = {
        "outcome": "supported",
        "next_action": "report_scoped",
        "evidence_refs": [REF_A],
        "lineage_count": 1,
    }
    model = ReplayModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "read_replayed_verification",
                        "id": "read-1",
                        "args": {"finding_id": "FIND-001"},
                    }
                ],
            ),
            AIMessage(content=json.dumps(answer)),
        ]
    )
    row = await run_episode(case, model, "baseline", timeout=5)
    assert row["bound_decision"] == answer
    assert row["scores"]["decision_correct"] is False
    assert row["scores"]["false_positive"] is True


@pytest.mark.asyncio
async def test_unrelated_current_read_is_not_citable_for_this_claim() -> None:
    case = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    case.replays["OTHER"] = {
        "outcome": "supported",
        "reference": REF_B,
        "invocation_id": "other-run",
    }
    content = json.dumps(
        {
            "outcome": "supported",
            "next_action": "report_scoped",
            "evidence_refs": [REF_B],
            "lineage_count": 1,
        }
    )
    model = ReplayModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "read_replayed_verification",
                        "id": "read-1",
                        "args": {"finding_id": "FIND-001"},
                    },
                    {
                        "name": "read_replayed_verification",
                        "id": "read-other",
                        "args": {"finding_id": "OTHER"},
                    },
                ],
            ),
            AIMessage(content=content),
        ]
    )
    row = await run_episode(case, model, "baseline", timeout=5)
    assert row["scores"]["scope_violations"] == 0
    assert row["bound_decision"] is None
    assert row["provenance"]["issues"] == ["unknown_reference", "unresolved_lineage"]
    assert row["content"] == content


@pytest.mark.asyncio
async def test_fixture_and_historical_snapshot_cannot_substitute_for_a_completed_read() -> None:
    case = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    content = json.dumps(
        {
            "outcome": "supported",
            "next_action": "report_scoped",
            "evidence_refs": [REF_A],
            "lineage_count": 1,
        }
    )
    row = await run_episode(
        case, ReplayModel(responses=[AIMessage(content=content)]), "evidence", timeout=5
    )
    assert row["observations"] == {}
    assert row["bound_decision"] is None
    assert "claim_reads_incomplete" in row["provenance"]["issues"]
    assert "unknown_reference" in row["provenance"]["issues"]


@pytest.mark.asyncio
async def test_attempted_forbidden_tool_blocks_otherwise_bound_answer() -> None:
    case = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    model = ReplayModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "read_replayed_verification",
                        "id": "read-1",
                        "args": {"finding_id": "FIND-001"},
                    },
                    {"name": "bash", "id": "outside", "args": {"command": "not-executed"}},
                ],
            ),
            AIMessage(
                content=json.dumps(
                    {
                        "outcome": "supported",
                        "next_action": "report_scoped",
                        "evidence_refs": [REF_A],
                        "lineage_count": 1,
                    }
                )
            ),
        ]
    )
    row = await run_episode(case, model, "baseline", timeout=5)
    assert row["error"] is None
    assert row["bound_decision"] is None
    assert "forbidden_tool_attempt" in row["provenance"]["issues"]


@pytest.mark.asyncio
async def test_claim_binding_is_frozen_before_unrelated_read_results_arrive() -> None:
    case = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    case.replays["OTHER"] = {
        "reference": REF_B,
        "invocation_id": "other-run",
        "outcome": "supported",
    }

    class MutatingProvider(ReplayModel):
        async def _agenerate(self, *args: Any, **kwargs: Any) -> Any:
            if self.i == 1:
                case.claim_replays.append("OTHER")
            return await super()._agenerate(*args, **kwargs)

    model = MutatingProvider(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "read_replayed_verification",
                        "id": "read-1",
                        "args": {"finding_id": "FIND-001"},
                    },
                    {
                        "name": "read_replayed_verification",
                        "id": "read-other",
                        "args": {"finding_id": "OTHER"},
                    },
                ],
            ),
            AIMessage(
                content=json.dumps(
                    {
                        "outcome": "supported",
                        "next_action": "report_scoped",
                        "evidence_refs": [REF_B],
                        "lineage_count": 1,
                    }
                )
            ),
        ]
    )
    row = await run_episode(case, model, "baseline", timeout=5)
    assert "OTHER" in case.claim_replays
    assert row["bound_decision"] is None
    assert "unknown_reference" in row["provenance"]["issues"]
