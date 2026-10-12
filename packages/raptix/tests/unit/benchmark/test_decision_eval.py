"""Decision-eval tests exercise scoring and agent replay without a provider network."""

import json
from pathlib import Path
from typing import Any

import pytest
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, BaseMessage

from benchmarks.engine.paths import BENCHMARKS_DIR
from benchmarks.suites.decision_eval.evaluate import (
    Scenario,
    load_scenarios,
    run_episode,
    score_decision,
    summarize,
)


def test_unsupported_report_is_a_false_positive_even_with_inconclusive_verdict() -> None:
    scenario = Scenario.model_validate(
        {
            "scenario_id": "drift",
            "objective": "Assess one claim",
            "finding_id": "FIND-1",
            "checkpoint": "A previously retained capture drifted.",
            "history": [],
            "snapshots": [],
            "replays": {"FIND-1": {"outcome": "inconclusive", "reason": "content_drift"}},
            "expected": {
                "outcome": "inconclusive",
                "accepted_actions": ["gather_evidence"],
                "evidence_refs": [],
                "lineage_count": 0,
                "required_reads": ["FIND-1"],
            },
        }
    )
    answer = json.dumps(
        {
            "outcome": "inconclusive",
            "next_action": "report_scoped",
            "evidence_refs": [],
            "lineage_count": 0,
        }
    )
    scored = score_decision(scenario, answer, ["FIND-1"], [])
    assert scored["false_positive"] is True
    assert scored["decision_correct"] is False


class ReplayModel(FakeMessagesListChatModel):
    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        return self


class PromptCapture(BaseCallbackHandler):
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def on_chat_model_start(
        self, serialized: dict[str, Any], messages: list[list[BaseMessage]], **kwargs: Any
    ) -> None:
        self.prompts.append("\n".join(str(message.content) for message in messages[0]))


@pytest.mark.asyncio
async def test_agent_consumes_replay_without_exposing_golden_answers() -> None:
    scenario = Scenario.model_validate(
        {
            "scenario_id": "fresh",
            "objective": "Assess one claim",
            "finding_id": "FIND-1",
            "checkpoint": "Decide the next step.",
            "history": [],
            "snapshots": [],
            "replays": {
                "FIND-1": {
                    "outcome": "supported",
                    "reference": "capture-A",
                    "invocation_id": "run-A",
                }
            },
            "expected": {
                "outcome": "supported",
                "accepted_actions": ["report_scoped"],
                "evidence_refs": ["capture-A"],
                "lineage_count": 1,
                "required_reads": ["FIND-1"],
            },
        }
    )
    capture = PromptCapture()
    model = ReplayModel(
        callbacks=[capture],
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "read_replayed_verification",
                        "id": "read-1",
                        "args": {"finding_id": "FIND-1"},
                    }
                ],
            ),
            AIMessage(
                content='{"outcome":"supported","next_action":"report_scoped","evidence_refs":["capture-A"],"lineage_count":1}'
            ),
        ],
    )
    result = await run_episode(scenario, model, "baseline", timeout=5)
    assert result["scores"]["decision_correct"] is True
    assert result["reads"] == ["FIND-1"]
    assert result["cost_usd"] is None
    assert "capture-A" not in capture.prompts[0]
    assert all(
        word not in capture.prompts[0]
        for word in ("accepted_actions", "required_reads", '"expected"')
    )


@pytest.mark.asyncio
async def test_ablation_changes_only_kg_evidence_context_and_restores_flags(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cases = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")
    scenario = cases[0]
    monkeypatch.setenv("RAPTIX_KG_EVIDENCE_CONTEXT", "caller-value")
    prompts = {}
    for variant in ("baseline", "evidence"):
        capture = PromptCapture()
        model = ReplayModel(responses=[AIMessage(content="not-json")], callbacks=[capture])
        result = await run_episode(scenario, model, variant, timeout=5)
        assert result["scores"]["valid_response"] is False
        prompts[variant] = capture.prompts[0]
    assert "UNTRUSTED_KG_EVIDENCE" not in prompts["baseline"]
    assert "UNTRUSTED_KG_EVIDENCE" in prompts["evidence"]
    assert "required_reads" not in prompts["evidence"]
    import os

    assert os.environ["RAPTIX_KG_EVIDENCE_CONTEXT"] == "caller-value"


def test_scoring_rejects_oracle_answer_without_required_reads() -> None:
    scenario = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    content = json.dumps(
        {
            "outcome": "supported",
            "next_action": "report_scoped",
            "evidence_refs": scenario.expected.evidence_refs,
            "lineage_count": 1,
        }
    )
    assert score_decision(scenario, content, [], [])["decision_correct"] is False


def test_duplicate_reads_are_counted() -> None:
    scenario = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    scored = score_decision(scenario, "invalid", ["FIND-001", "FIND-001"], [])
    assert scored["redundant_reads"] == 1


def test_foreign_lookup_and_forbidden_tool_attempt_are_scope_violations() -> None:
    scenario = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    scored = score_decision(scenario, "invalid", ["FOREIGN"], ["bash"])
    assert scored["scope_violations"] == 2


def test_shared_lineage_cannot_be_scored_as_independent_sources() -> None:
    scenario = next(
        case
        for case in load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")
        if case.scenario_id == "shared-lineage"
    )
    content = json.dumps(
        {
            "outcome": "supported",
            "next_action": "report_scoped",
            "evidence_refs": scenario.expected.evidence_refs,
            "lineage_count": 2,
        }
    )
    scored = score_decision(scenario, content, ["FIND-005", "FIND-005-ALIAS"], [])
    assert scored["verdict_correct"] is True
    assert scored["lineage_correct"] is False
    assert scored["decision_correct"] is False


@pytest.mark.asyncio
async def test_timeout_is_a_failed_episode_with_unknown_usage() -> None:
    scenario = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    model = ReplayModel(responses=[AIMessage(content="irrelevant")], sleep=1)
    row = await run_episode(scenario, model, "baseline", timeout=0.01)
    assert row["error"] == "TimeoutError"
    assert row["scores"]["decision_correct"] is False
    assert row["input_tokens"] is None and row["cost_usd"] is None


def test_paired_summary_keeps_failures_in_denominator() -> None:
    scenario = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]
    content = json.dumps(
        {
            "outcome": "supported",
            "next_action": "report_scoped",
            "evidence_refs": scenario.expected.evidence_refs,
            "lineage_count": 1,
        }
    )
    rows = [
        {
            "scenario_id": scenario.scenario_id,
            "model": "test",
            "variant": variant,
            "expected_outcome": "supported",
            "scores": score_decision(
                scenario, content if variant == "evidence" else "invalid", ["FIND-001"], []
            ),
            "error": "ProviderError" if variant == "baseline" else None,
        }
        for variant in ("baseline", "evidence")
    ]
    report = summarize(rows)
    assert report["paired_decision_gain"]["test"] == 1
    assert report["groups"]["test:baseline"]["provider_failures"] == 1
    assert report["groups"]["test:baseline"]["decision_correct"] == 0
    with pytest.raises(ValueError, match="both conditions"):
        summarize(rows[:1])
    with pytest.raises(ValueError, match="duplicate"):
        summarize(rows + rows[:1])


def test_cli_runs_both_conditions_against_scripted_http_provider(tmp_path: Path) -> None:
    import os
    import subprocess
    import sys
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from benchmarks.engine.paths import REPO_ROOT

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return None

        def do_POST(self) -> None:
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            user = next(message for message in request["messages"] if message["role"] == "user")
            checkpoint = json.loads(user["content"])
            assert "expected" not in checkpoint and "required_reads" not in checkpoint
            if request["messages"][-1]["role"] == "tool":
                message = {
                    "role": "assistant",
                    "content": json.dumps(
                        {
                            "outcome": "supported",
                            "next_action": "report_scoped",
                            "evidence_refs": ["workspace-evidence://" + "a" * 64],
                            "lineage_count": 1,
                        }
                    ),
                }
                finish = "stop"
            else:
                message = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "type": "function",
                            "id": "read-1",
                            "function": {
                                "name": "read_replayed_verification",
                                "arguments": json.dumps(
                                    {"finding_id": checkpoint["available_replays"][0]}
                                ),
                            },
                        }
                    ],
                }
                finish = "tool_calls"
            body = json.dumps(
                {
                    "id": "scripted",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "scripted-http",
                    "choices": [{"index": 0, "message": message, "finish_reason": finish}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        command = [
            sys.executable,
            "-m",
            "benchmarks.suites.decision_eval",
            "--model",
            "scripted-http",
            "--output",
            str(tmp_path / "report"),
            "--timeout",
            "10",
        ]
        env = {
            **os.environ,
            "RAPTIX_PLUGINS": "__benchmark_tests__",
            "RAPTIX_LLM__PROXY_URL": f"http://127.0.0.1:{server.server_port}",
            "RAPTIX_LLM__PROXY_API_KEY": "scripted-secret-not-for-report",
        }
        completed = subprocess.run(
            command, env=env, cwd=REPO_ROOT, text=True, capture_output=True, timeout=90
        )
        assert completed.returncode == 0, completed.stderr
        report_text = (tmp_path / "report/report.json").read_text(encoding="utf-8")
        report = json.loads(report_text)
        assert "scripted-secret-not-for-report" not in report_text
        assert len(report["episodes"]) == 12
        assert report["summary"]["groups"]["scripted-http:baseline"]["decision_correct"] == 1 / 6
        assert report["summary"]["groups"]["scripted-http:evidence"]["false_positive_rate"] == 1
        assert report["summary"]["paired_decision_gain"]["scripted-http"] == 0
        assert all(
            row["input_tokens"] == 20 and row["cost_usd"] is None for row in report["episodes"]
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(5)


@pytest.mark.asyncio
async def test_completed_tool_attempt_survives_later_provider_failure() -> None:
    scenario = load_scenarios(BENCHMARKS_DIR / "scenarios/decision-eval/dev.json")[0]

    class FailingProvider(ReplayModel):
        async def _agenerate(self, *args: Any, **kwargs: Any) -> Any:
            if self.i == 1:
                raise RuntimeError("provider failed on the next turn")
            return await super()._agenerate(*args, **kwargs)

    model = FailingProvider(
        responses=[
            AIMessage(
                content="",
                tool_calls=[{"name": "bash", "id": "outside", "args": {"command": "not-executed"}}],
            ),
            AIMessage(content="never reached"),
        ]
    )
    row = await run_episode(scenario, model, "baseline", timeout=5)
    assert row["error"] == "RuntimeError"
    assert row["scores"]["scope_violations"] == 1
    assert row["completed_model_turns"] == 1
    assert row["cost_usd"] is None
