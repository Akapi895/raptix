"""Benign live-route acceptance: two persisted steps with a history-wipe checkpoint."""

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Literal, NotRequired

from deepagents.backends import CompositeBackend
from deepagents.backends.filesystem import FilesystemBackend
from dotenv import dotenv_values
from langchain.agents import AgentState, create_agent
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph.message import REMOVE_ALL_MESSAGES

from raptix.execution.tools.opplan import _persist_opplan_to_backend
from raptix.intelligence.agents.build import build_middleware
from raptix.intelligence.llm.factory import _ProxiedChatOpenAI
from raptix.middleware.filesystem import EngagementFilesystemBackend
from raptix.orchestration.mission.task_state import read_task_state
from raptix.runtime.recording import _SINKS, export_sanitized
from raptix_core.contracts.slots import MiddlewareSlot as Slot


class Workspace(AgentState):
    workspace_path: NotRequired[str]


class ScriptedParent(GenericFakeChatModel):
    turn: int = 0

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        metadata = getattr(run_manager, "metadata", {}) or {}
        if metadata.get("lc_source") == "summarization":
            reply = AIMessage(
                content='## SESSION INTENT\nContinue persisted work.\n## SUMMARY\nUse task state.\n## ARTIFACTS\n/workspace/evidence/\n## NEXT STEPS\nContinue.\n```json\n{"completed_work":[],"evidence":[],"failed_attempts":[],"unresolved":[],"hypotheses":[]}\n```'
            )
        else:
            index = self.turn
            self.turn += 1
            if index == 0:
                reply = AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "load_opplan",
                            "id": "load",
                            "args": {"workspace_path": "/workspace/lab"},
                        }
                    ],
                )
            elif index in {1, 3}:
                step = "first" if index == 1 else "second"
                description = (
                    f"Benign synthetic acceptance test. Execute record_step(step='{step}') exactly once. "
                    "Do not execute any other step in this dispatch. Then return ONLY the JSON WorkerResult described below, "
                    "without Markdown fences. Copy the persisted ref and sha256 returned by the tool into evidence_refs. "
                    "Do not mark the objective completed. Use persisted WorkerInput to avoid repeating completed work."
                )
                reply = AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "task",
                            "id": f"dispatch-{index}",
                            "args": {
                                "description": description,
                                "subagent_type": "worker",
                                "objective_id": "A",
                                "dispatch_id": f"dispatch-{index}",
                            },
                        }
                    ],
                )
            else:
                reply = AIMessage(content="checkpoint" if index == 2 else "finished")
        return ChatResult(generations=[ChatGeneration(message=reply)])


def run(env_file: Path, output: Path) -> dict:
    settings = dotenv_values(env_file, interpolate=False)
    for key, value in settings.items():
        if key.startswith("RAPTIX_") and value is not None:
            os.environ[key] = value
    os.environ["RAPTIX_SKIP_BOOT"] = "1"
    os.environ["RAPTIX_USE_SKILLOGY"] = "0"
    os.environ["RAPTIX_SUMMARIZATION_TRIGGER_TOKENS"] = "250"
    os.environ["RAPTIX_SUMMARIZATION_KEEP_MESSAGES"] = "1"
    model_name = "custom/" + str(settings["CUSTOM_OPENAI_MODEL"])
    key = settings.get("RAPTIX_LLM__PROXY_API_KEY") or settings["LITELLM_MASTER_KEY"]
    report = {"requested_model": model_name, "synthetic_environment": True, "history_wiped": False}
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        record = root / "raw.jsonl"
        os.environ["RAPTIX_RUNTIME__RECORD_PATH"] = str(record)
        os.environ["RAPTIX_RUNTIME__RECORD_LEVEL"] = "raw"
        backend = CompositeBackend(
            default=FilesystemBackend(root_dir=root / "files", virtual_mode=True), routes={}
        )
        scoped = EngagementFilesystemBackend(backend, "/workspace/lab")
        objective = {
            "id": "A",
            "title": "two synthetic persisted steps",
            "phase": "recon",
            "description": "Record first then second",
            "status": "in-progress",
            "priority": 1,
            "acceptance_criteria": ["two evidence files exist"],
        }
        _persist_opplan_to_backend(backend, "/workspace/lab", [objective], "lab", "acceptance")
        actions = []

        @tool(response_format="content_and_artifact")
        def record_step(step: Literal["first", "second"]) -> tuple[str, dict]:
            """Record exactly one benign step and return its persisted evidence ref/hash."""
            if step in actions:
                return json.dumps(
                    {"error": "already_completed", "ref": f"/workspace/evidence/{step}.txt"}
                ), {}
            actions.append(step)
            saved = scoped.write(f"/workspace/evidence/{step}.txt", step)
            if saved.error:
                raise OSError("synthetic evidence persistence failed")
            reference = {
                "ref": f"/workspace/evidence/{step}.txt",
                "sha256": hashlib.sha256(step.encode()).hexdigest(),
            }
            return json.dumps({"step": step, **reference}), {"evidence_refs": [reference]}

        slots = frozenset(
            {
                Slot.ROE_GUARDRAIL,
                Slot.UNTRUSTED_OUTPUT,
                Slot.PROMPT_INJECTION_SHIELD,
                Slot.TASK_BUDGET,
                Slot.TRIED_EDGES,
                Slot.EXECUTION_LEDGER,
                Slot.SUMMARIZATION,
                Slot.CONTEXT_MANIFEST,
                Slot.RECORD,
            }
        )
        live = _ProxiedChatOpenAI(
            model=model_name,
            api_key=key,
            base_url="http://localhost:4000/v1",
            max_tokens=16384,
            timeout=120,
        )
        child = create_agent(
            live,
            tools=[record_step],
            state_schema=Workspace,
            middleware=build_middleware(role="recon", backend=backend, llm=live, slots=slots),
        )
        parent_model = ScriptedParent(messages=iter([]))
        parent = create_agent(
            parent_model,
            checkpointer=InMemorySaver(),
            state_schema=Workspace,
            middleware=build_middleware(
                role="raptix",
                backend=backend,
                llm=parent_model,
                slots=slots | {Slot.SUBAGENT, Slot.OPPLAN},
                subagents=[
                    {"name": "worker", "description": "benign live acceptance", "runnable": child}
                ],
            ),
        )
        config = {
            "configurable": {
                "thread_id": "live-context-acceptance",
                "workspace_path": "/workspace/lab",
            },
            "recursion_limit": 30,
        }
        try:
            parent.invoke(
                {
                    "messages": [HumanMessage(content="synthetic test")],
                    "workspace_path": "/workspace/lab",
                },
                config,
            )
            parent.update_state(config, {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES)]})
            report["history_wiped"] = True
            parent.invoke(
                {"messages": [HumanMessage(content="resume from persisted state")]}, config
            )
            state = read_task_state(scoped, "A").state
            rows = [json.loads(line) for line in record.read_text(encoding="utf-8").splitlines()]
            report.update(
                actions=actions,
                budget=state.budget.model_dump() if state else None,
                evidence_count=len(state.evidence_refs) if state else 0,
                owner_released=state.owner_lease is None if state else False,
                objective_status=state.work_state.status.value if state else None,
                summary_calls=sum(row.get("kind") == "summary_call" for row in rows),
                http_attempts=sum(row.get("kind") == "upstream_attempt" for row in rows),
            )
            report["passed"] = (
                actions == ["first", "second"]
                and report["evidence_count"] == 2
                and report["owner_released"]
                and report["objective_status"] == "running"
            )
            if not report["passed"]:
                debug_path = output.with_suffix(".debug.jsonl")
                export_sanitized(record, debug_path)
                report["sanitized_debug_path"] = str(debug_path)
        except Exception as exc:
            report.update(passed=False, error_type=type(exc).__name__, actions=actions)
        finally:
            for sink in _SINKS.values():
                if not sink.closed:
                    sink.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.env_file, args.out), indent=2))


if __name__ == "__main__":
    main()
