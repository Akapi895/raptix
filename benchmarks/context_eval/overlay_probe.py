"""Measure real overlay renderers on synthetic data, without a model call.

Run: python -m benchmarks.context_eval.overlay_probe
Only counts and hashes are printed; fixtures are synthetic, not Silentium data.
"""

import argparse
import json
import os
import tempfile
from types import SimpleNamespace

from deepagents.backends.filesystem import FilesystemBackend
from langchain.agents.middleware.types import ModelRequest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import HumanMessage, ToolMessage

from raptix.intelligence.context.blocks import owned_scope
from raptix.intelligence.context.manifest import build_manifest
from raptix.middleware.context_manifest import ContextManifestMiddleware
from raptix.middleware.kg import KGMiddleware
from raptix.middleware.skillogy import SkillogyMiddleware
from raptix.orchestration.mission.opplan import OPPLANMiddleware


class SkillFixture:
    def query_moc_summary(self, phase: str) -> list[dict]:
        return [
            {"name": f"concept-{index}", "description": "fixture description " * 20}
            for index in range(24)
        ]


def fixture_request(count: int) -> ModelRequest:
    objectives = [
        {
            "id": f"OBJ-{index:03d}",
            "title": f"synthetic objective {index}",
            "description": "persisted objective",
            "phase": "recon",
            "priority": index,
            "status": "in-progress" if index == 1 else "pending",
            "acceptance_criteria": ["retain evidence"],
            "blocked_by": [],
            "parent_id": None,
        }
        for index in range(1, count + 1)
    ]
    return ModelRequest(
        model=GenericFakeChatModel(messages=iter([])),
        tools=[],
        messages=[
            HumanMessage("synthetic objective"),
            ToolMessage("synthetic output " * 1000, tool_call_id="t"),
            HumanMessage("continue"),
        ],
        state={
            "objectives": objectives,
            "active_objective_id": "OBJ-001",
            "kg_engagement": "fixture",
            "kg_revision": "fixture:1",
            "kg_summary": "synthetic KG observation\n" * count,
            "workspace_path": "/workspace",
        },
        runtime=SimpleNamespace(config={}, state={}),
    )


def measure(count: int, backend=None) -> dict:
    request = fixture_request(count)
    costs = {}
    for owner, middleware, inject in (
        ("skillogy", SkillogyMiddleware(agent_phase="recon", backend=SkillFixture()), "_inject"),
        ("opplan", OPPLANMiddleware(), "_inject_opplan_context"),
        ("kg", KGMiddleware(store=SimpleNamespace(), enabled_tools=[]), "_inject_kg_context"),
    ):
        previous = len(request.system_message.text) if request.system_message else 0
        request = getattr(middleware, inject)(request)
        costs[owner] = len(request.system_message.text) - previous
    manifest = build_manifest(request)
    return {
        "objectives": count,
        "overlay_chars": costs,
        "request_chars": manifest["total_chars"],
        "estimated_tokens": manifest["total_token_estimate"],
    }


def compare(count: int, backend: object) -> dict:
    request = fixture_request(count)
    with owned_scope():
        request = SkillogyMiddleware(agent_phase="recon", backend=SkillFixture())._inject(request)
        request = OPPLANMiddleware()._inject_opplan_context(request)
        request = KGMiddleware(store=SimpleNamespace(), enabled_tools=[])._inject_kg_context(
            request
        )
        before = build_manifest(request)
        processed = ContextManifestMiddleware(backend=backend)._process(request)
        after = build_manifest(processed)
        return {
            "objectives": count,
            "before_chars": before["total_chars"],
            "after_chars": after["total_chars"],
            "overlay_chars": {
                owner: sum(block["chars"] for block in after["blocks"] if block["owner"] == owner)
                for owner in ("skillogy", "opplan", "kg")
            },
            "budget_tokens": int(os.environ.get("RAPTIX_CONTEXT_BUDGET_TOKENS", "0")),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--budget", type=int, default=0)
    parser.add_argument("--mask", action="store_true")
    args = parser.parse_args()
    os.environ["RAPTIX_CONTEXT_ASSEMBLY"] = "1"
    os.environ["RAPTIX_CONTEXT_BUDGET_TOKENS"] = str(args.budget)
    os.environ["RAPTIX_CONTEXT_MASK"] = "1" if args.mask else "0"
    os.environ["RAPTIX_CONTEXT_MASK_AFTER_TURNS"] = "1"
    with tempfile.TemporaryDirectory(prefix="context-eval-") as directory:
        backend = FilesystemBackend(root_dir=directory, virtual_mode=True)
        print(json.dumps([compare(count, backend) for count in (2, 120)], indent=2))


if __name__ == "__main__":
    main()
