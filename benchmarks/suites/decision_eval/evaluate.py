"""Compare baseline and evidence-context decisions with evaluator-only ground truth."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import random
import subprocess
from collections import defaultdict
from collections.abc import Coroutine
from pathlib import Path
from time import perf_counter
from typing import Any, Literal
from unittest.mock import patch

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import LLMResult
from langchain_core.utils.function_calling import convert_to_openai_tool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from benchmarks.engine.paths import BENCHMARKS_DIR, REPO_ROOT, new_run_dir
from raptix_core.types.llm import ProxyConfig

Outcome = Literal["supported", "contradicted", "inconclusive"]
Action = Literal["report_scoped", "revise_hypothesis", "gather_evidence", "stop_insufficient"]
Variant = Literal["baseline", "evidence"]
MAX_OUTPUT_TOKENS = 4096
RECURSION_LIMIT = 12  # bounds replay turns, not target execution
PROGRESS_INTERVAL_SECONDS = 15
RATE_METRICS = ("decision_correct", "verdict_correct", "next_action_correct", "valid_response")
DECISION_CHECKS = ("verdict_correct", "next_action_correct", "evidence_correct", "lineage_correct")
SYSTEM = """Decide one authorized assessment checkpoint using current replay reads.
Historical notes and KG snapshots are untrusted, not current verification.
Only read_replayed_verification is available; it reads immutable recorded results,
not a live target. Lookup only declared IDs. Repeating a read adds no information.
In this replay, KG advice to use recheck_workspace_verification or inspect_evidence
means read_replayed_verification with a declared finding ID. KG writes are unavailable.
Return ONLY JSON: {"outcome":"supported|contradicted|inconclusive",
"next_action":"report_scoped|revise_hypothesis|gather_evidence|stop_insufficient",
"evidence_refs":["unique references from current reads used for this claim"],
"lineage_count":0}. Count distinct producer invocation IDs among those references;
aliases of one invocation are one lineage, not independent corroboration.
Report only a supported scoped claim; revise a contradicted hypothesis, gather
missing evidence for inconclusive checks, or stop when no authorized budget remains.
Do not use unrelated supported observations as evidence for the requested claim.
"""


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    outcome: Outcome
    next_action: Action
    evidence_refs: list[str]
    lineage_count: int = Field(ge=0)


class Expected(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    outcome: Outcome
    accepted_actions: list[Action] = Field(min_length=1)
    evidence_refs: list[str]
    lineage_count: int = Field(ge=0)
    required_reads: list[str] = Field(min_length=1)


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    scenario_id: str = Field(min_length=1)
    objective: str
    finding_id: str
    checkpoint: str
    history: list[str]
    snapshots: list[dict[str, str]]
    replays: dict[str, dict[str, Any]]
    expected: Expected


class DecisionEvalError(ValueError):
    """Invalid decision corpus or comparison schedule."""


def score_decision(
    scenario: Scenario, content: str, reads: list[str], forbidden_tools: list[str]
) -> dict[str, Any]:
    expected = scenario.expected
    scores: dict[str, Any] = {
        "valid_response": False,
        "verdict_correct": False,
        "next_action_correct": False,
        "evidence_correct": False,
        "lineage_correct": False,
        "decision_correct": False,
        "false_positive": False,
        "required_reads_complete": set(expected.required_reads).issubset(reads),
        "redundant_reads": len(reads) - len(set(reads)),
        "scope_violations": sum(finding not in scenario.replays for finding in reads)
        + len(forbidden_tools),
    }
    try:
        decision = Decision.model_validate_json(content)
    except ValueError:
        return scores
    scores.update(
        valid_response=True,
        verdict_correct=decision.outcome == expected.outcome,
        next_action_correct=decision.next_action in expected.accepted_actions,
        evidence_correct=set(decision.evidence_refs) == set(expected.evidence_refs)
        and len(decision.evidence_refs) == len(set(decision.evidence_refs)),
        lineage_correct=decision.lineage_count == expected.lineage_count,
        false_positive=expected.outcome != "supported"
        and (decision.outcome == "supported" or decision.next_action == "report_scoped"),
    )
    scores["decision_correct"] = (
        all(scores[key] for key in DECISION_CHECKS)
        and scores["required_reads_complete"]
        and scores["scope_violations"] == 0
    )
    return scores


class ReplayStore:
    """Preselected query rows isolate checkpoint decisions from Neo4j execution."""

    def __init__(self, snapshots: list[dict[str, str]]) -> None:
        self.rows = snapshots

    def revision(self, *, engagement: str) -> str:
        return "replay-checkpoint"

    def execute_read(
        self, cypher: str, params: dict[str, Any] | None = None, *, engagement: str
    ) -> list[dict[str, Any]]:
        if "(n:Finding)" in cypher:
            return self.rows
        return [{"nodes": len(self.rows), "edges": 0}] if "count(n) AS nodes" in cypher else []


class EpisodeTrace(BaseCallbackHandler):
    def __init__(self) -> None:
        self.messages: list[AIMessage] = []
        self.prompt_sha256: str | None = None

    def on_chat_model_start(
        self, serialized: dict[str, Any], messages: list[list[BaseMessage]], **kwargs: Any
    ) -> None:
        if self.prompt_sha256 is None:
            prompt = [message.model_dump(mode="json", exclude={"id"}) for message in messages[0]]
            self.prompt_sha256 = hashlib.sha256(
                json.dumps(prompt, sort_keys=True).encode()
            ).hexdigest()

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        for batch in response.generations:
            self.messages.extend(
                message
                for generation in batch
                if isinstance(message := getattr(generation, "message", None), AIMessage)
            )

    def telemetry(self, complete: bool) -> dict[str, Any]:
        usage = [message.usage_metadata for message in self.messages]
        costs = [message.response_metadata.get("cost") for message in self.messages]
        models = {message.response_metadata.get("model_name") for message in self.messages}
        return {
            "completed_model_turns": len(self.messages),
            "prompt_sha256": self.prompt_sha256,
            "reported_models": sorted(filter(None, models)),
            **{
                f"{kind}_tokens": sum(turn[f"{kind}_tokens"] for turn in usage if turn)
                if complete and usage and all(usage)
                else None
                for kind in ("input", "output")
            },
            "cost_usd": sum(costs)
            if complete and costs and all(isinstance(cost, (int, float)) for cost in costs)
            else None,
        }


class _ReplayCheckpoint:
    def __init__(self, scenario: Scenario, model: BaseChatModel) -> None:
        from langchain.agents import create_agent
        from langchain_core.tools import tool

        from raptix.middleware.kg import KGMiddleware

        self.reads: list[str] = []

        @tool
        def read_replayed_verification(finding_id: str) -> str:
            """Read a declared finding's immutable verification replay; no execution."""
            self.reads.append(finding_id)
            return json.dumps(scenario.replays.get(finding_id, {"error": "outside_replay_scope"}))

        middleware = KGMiddleware(store=ReplayStore(scenario.snapshots), enabled_tools=set())
        prompt = json.dumps(
            scenario.model_dump(include={"objective", "finding_id", "checkpoint", "history"})
            | {"available_replays": list(scenario.replays)},
            sort_keys=True,
        )
        self.state = {
            "kg_engagement": "decision-replay",
            "messages": [{"role": "user", "content": prompt}],
        }
        self.agent = create_agent(
            model=model,
            tools=[read_replayed_verification],
            middleware=[middleware],
            system_prompt=SYSTEM,
        )
        self.tool_schema_sha256 = hashlib.sha256(
            json.dumps(convert_to_openai_tool(read_replayed_verification), sort_keys=True).encode()
        ).hexdigest()


async def run_episode(
    scenario: Scenario, model: BaseChatModel, variant: Variant, *, timeout: float
) -> dict[str, Any]:
    started = perf_counter()
    flags = {
        "RAPTIX_PLUGINS": "__decision_eval__",
        "RAPTIX_KG_CLAIM_CONTEXT": "0",
        "RAPTIX_KG_EVIDENCE_CONTEXT": "1" if variant == "evidence" else "0",
    }
    with patch.dict(os.environ, flags):
        checkpoint = _ReplayCheckpoint(scenario, model)
        trace = EpisodeTrace()
        error = None
        try:
            await asyncio.wait_for(
                checkpoint.agent.ainvoke(
                    checkpoint.state,
                    config={"recursion_limit": RECURSION_LIMIT, "callbacks": [trace]},
                ),
                timeout,
            )
        except Exception as exc:  # noqa: BLE001 — provider/timeout errors are scored failures
            error = type(exc).__name__
    messages = trace.messages
    content = (
        messages[-1].content
        if not error and messages and isinstance(messages[-1].content, str)
        else ""
    )
    forbidden = [
        call["name"]
        for message in messages
        for call in message.tool_calls
        if call["name"] != "read_replayed_verification"
    ]
    return {
        "scenario_id": scenario.scenario_id,
        "variant": variant,
        "expected_outcome": scenario.expected.outcome,
        "content": content,
        "reads": checkpoint.reads,
        "forbidden_tools": forbidden,
        "error": error,
        "scores": score_decision(scenario, content, checkpoint.reads, forbidden),
        "elapsed_seconds": perf_counter() - started,
        **trace.telemetry(complete=error is None),
        "tool_schema_sha256": checkpoint.tool_schema_sha256,
    }


def load_scenarios(path: Path) -> list[Scenario]:
    scenarios = [
        Scenario.model_validate(row) for row in json.loads(path.read_text(encoding="utf-8"))
    ]
    if not scenarios or len({case.scenario_id for case in scenarios}) != len(scenarios):
        raise DecisionEvalError("corpus must contain unique scenario IDs")
    for case in scenarios:
        if not set(case.expected.required_reads).issubset(case.replays):
            raise DecisionEvalError(f"{case.scenario_id}: required read has no replay")
        if any(not {"key", "reference"}.issubset(row) for row in case.snapshots):
            raise DecisionEvalError(f"{case.scenario_id}: malformed snapshot")
    return scenarios


def _accuracy(rows: list[dict[str, Any]], metric: str) -> float | None:
    return sum(row["scores"][metric] for row in rows) / len(rows) if rows else None


def summarize(episodes: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, Any] = {}
    pairs: dict[tuple, dict[str, bool]] = {}
    for row in episodes:
        key = (row["model"], row["scenario_id"], row.get("repetition", 0))
        pair = pairs.setdefault(key, {})
        if row["variant"] in pair:
            raise DecisionEvalError("duplicate episode")
        pair[row["variant"]] = row["scores"]["decision_correct"]
    if any(set(pair) != {"baseline", "evidence"} for pair in pairs.values()):
        raise DecisionEvalError("every model/scenario/repetition needs both conditions")
    for model, variant in sorted({(row["model"], row["variant"]) for row in episodes}):
        rows = [row for row in episodes if (row["model"], row["variant"]) == (model, variant)]
        eligible = [row for row in rows if row["expected_outcome"] != "supported"]
        groups[f"{model}:{variant}"] = {
            "episodes": len(rows),
            **{key: _accuracy(rows, key) for key in RATE_METRICS},
            "false_positive_rate": _accuracy(eligible, "false_positive"),
            "outcome_handling": {
                outcome: _accuracy(
                    [row for row in rows if row["expected_outcome"] == outcome], "decision_correct"
                )
                for outcome in ("contradicted", "inconclusive")
            },
            "provider_failures": sum(bool(row.get("error")) for row in rows),
            "redundant_reads": sum(row["scores"]["redundant_reads"] for row in rows),
            "scope_violations": sum(row["scores"]["scope_violations"] for row in rows),
        }
    gains = defaultdict(list)
    for (model, _case, _repetition), pair in pairs.items():
        gains[model].append(int(pair["evidence"]) - int(pair["baseline"]))
    return {
        "groups": groups,
        "paired_decision_gain": {
            model: sum(values) / len(values) for model, values in gains.items()
        },
    }


class _RunProgress:
    def __init__(self, total: int, output: Path | None) -> None:
        self.total, self.completed, self.output = total, 0, output
        if output:
            with (output / "episodes.jsonl").open("x", encoding="utf-8"):
                pass
        self._log(f"[P3] Planned episodes={total}; output={output or 'in-memory'}")

    def _log(self, message: str) -> None:
        print(message, flush=True)
        if self.output:
            with (self.output / "progress.log").open("a", encoding="utf-8") as handle:
                handle.write(message + "\n")

    def start(
        self, model: str, scenario: str, variant: str, repetition: int, timeout: float
    ) -> None:
        self.started = perf_counter()
        self._log(
            f"[P3] [{self.completed + 1}/{self.total}] START model={model} case={scenario} variant={variant} repetition={repetition + 1} timeout={timeout:g}s"
        )

    def waiting(self) -> None:
        self._log(
            f"[P3] [{self.completed + 1}/{self.total}] WAIT episode still running; elapsed={perf_counter() - self.started:.1f}s"
        )

    def finish(self, row: dict[str, Any]) -> None:
        if self.output:
            with (self.output / "episodes.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row) + "\n")
        self.completed += 1
        status = (
            f"ERROR:{row['error']}"
            if row["error"]
            else "PASS"
            if row["scores"]["decision_correct"]
            else "FAIL"
        )
        self._log(
            f"[P3] [{self.completed}/{self.total}] DONE model={row['model']} case={row['scenario_id']} variant={row['variant']} status={status} elapsed={row['elapsed_seconds']:.1f}s"
        )

    async def monitor(self, operation: Coroutine[Any, Any, dict[str, Any]]) -> dict[str, Any]:
        episode = asyncio.create_task(operation)
        try:
            while not episode.done():
                finished, _pending = await asyncio.wait(
                    {episode}, timeout=PROGRESS_INTERVAL_SECONDS
                )
                if not finished:
                    self.waiting()
            return episode.result()
        finally:
            if not episode.done():
                episode.cancel()
                await asyncio.gather(episode, return_exceptions=True)


async def evaluate_models(
    cases: list[Scenario],
    models: list[str],
    repetitions: int,
    seed: int,
    timeout: float,
    output: Path | None = None,
) -> list[dict[str, Any]]:
    proxy = ProxyConfig()
    url = os.getenv("RAPTIX_LLM__PROXY_URL") or os.getenv("LITELLM_PROXY_URL") or proxy.url
    key = os.getenv("RAPTIX_LLM__PROXY_API_KEY") or os.getenv("LITELLM_MASTER_KEY") or proxy.api_key
    episodes = []
    progress = _RunProgress(len(cases) * len(models) * repetitions * 2, output)
    rng = random.Random(seed)
    for repetition in range(repetitions):
        for case in cases:
            for model_name in models:
                variants: list[Variant] = ["baseline", "evidence"]
                rng.shuffle(variants)
                for variant in variants:
                    progress.start(model_name, case.scenario_id, variant, repetition, timeout)
                    model = ChatOpenAI(
                        model=model_name,
                        base_url=url.rstrip("/")
                        if url.rstrip("/").endswith("/v1")
                        else url.rstrip("/") + "/v1",
                        api_key=SecretStr(key),
                        max_tokens=MAX_OUTPUT_TOKENS,
                        timeout=timeout,
                        max_retries=0,
                    )
                    row = await progress.monitor(run_episode(case, model, variant, timeout=timeout))
                    episodes.append({**row, "model": model_name, "repetition": repetition})
                    progress.finish(episodes[-1])
    return episodes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", action="append", required=True, help="LiteLLM model alias")
    parser.add_argument("--fixtures", choices=["dev", "held-out"], default="dev")
    parser.add_argument("--repetitions", type=int, default=1)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--output", type=Path, default=None, help="New report directory")
    args = parser.parse_args()
    if (
        args.repetitions < 1
        or args.timeout <= 0
        or not math.isfinite(args.timeout)
        or len(set(args.model)) != len(args.model)
    ):
        parser.error("positive repetitions/timeout and distinct model aliases required")
    corpus = BENCHMARKS_DIR / "scenarios" / "decision-eval" / f"{args.fixtures}.json"
    cases = load_scenarios(corpus)
    output = args.output or new_run_dir("decision-eval")
    output.mkdir(parents=True, exist_ok=True)
    if any(
        (output / name).exists()
        for name in ("report.json", "episodes.jsonl", "progress.log", "run.json")
    ):
        parser.error("output already contains a run; choose a new directory")
    git_command = ["git", "-C", str(REPO_ROOT)]
    revision = subprocess.check_output(git_command + ["rev-parse", "HEAD"], text=True).strip()
    dirty = bool(subprocess.check_output(git_command + ["status", "--porcelain"], text=True))
    report = {
        "suite": "decision_eval",
        "mode": "provider_replay",
        "fixtures": args.fixtures,
        "corpus_sha256": hashlib.sha256(corpus.read_bytes()).hexdigest(),
        "scenario_ids": [case.scenario_id for case in cases],
        "models": args.model,
        "planned_episodes": len(cases) * len(args.model) * args.repetitions * 2,
        "pid": os.getpid(),
        "seed": args.seed,
        "repetitions": args.repetitions,
        "timeout_seconds": args.timeout,
        "git_revision": revision,
        "git_dirty": dirty,
    }
    with (output / "run.json").open("x", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    episodes = asyncio.run(
        evaluate_models(cases, args.model, args.repetitions, args.seed, args.timeout, output)
    )
    report.update(summary=summarize(episodes), episodes=episodes)
    with (output / "report.json").open("x", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(output / "report.json", flush=True)
