"""T0b baseline capture — assembled model-facing surface per OSS role.

Wave T0 of ``docs/tool-optimization-implementation-plan.md``. Added after
the freeze review found T0a (``capture_baseline.py``) captures only the
static ``build_tools()`` surface — several middleware slots inject MORE
tools at ``create_agent()`` time via a generic ``self.tools`` attribute
(``FilesystemMiddleware``, ``SkillsMiddleware``/``SkillogyMiddleware``,
``DispatchMiddleware`` (SUBAGENT), ``OPPLANMiddleware``, ``KGMiddleware``).
A role with ``static=0, middleware=7`` was invisible to T0a entirely.

This script builds, for every OSS role with a concrete factory in
``raptix.intelligence.agents.standard``, BOTH halves — static tools (same
source as T0a) and every middleware slot instance's ``.tools`` — and
records the final union with per-source provenance, not just a final
count.

Run from the repo root:

    uv run python benchmarks/tool_eval/baseline/capture_assembled_baseline.py

Writes ``benchmarks/tool_eval/baseline/assembled_baseline.jsonl``. First
line is a ``_meta`` header row pinning the exact baseline profile (which
env vars were set/unset, so "the baseline" is one reproducible thing, not
whatever the operator's shell happened to export); remaining lines are one
row per role.

Scope — same as T0a: ``packages/raptix`` core OSS roles only (11: the 10
``_STANDARD_TOOLS`` roles + ``raptix``). Domain-plugin roles (ad_operator,
cloud_hunter, contract_auditor, reverser, phisher, mobile_operator,
wireless_operator, ics_operator, iot_operator) select by name from this
same core tool inventory via ``compose_domain_agent`` — see
``docs/architecture/tool-classification.md``'s Method section — and are
not captured separately here. The Ghidra MCP bridge and any plugin-loaded
MCP surface are dynamic/external and are never captured by this script;
``dynamic_external_surfaces`` below is always empty — a documented
limitation, not a measurement.

Environment dependency: the KG slot (``MiddlewareSlot.KG``) requires a
reachable Neo4j (``KGStore.from_env()``); when unavailable it returns
``None`` (the agent factory's own degrade-gracefully behavior) and this
script records that explicitly as a SKIPPED slot with its statically-known
tool names (from the classification doc), rather than silently reporting
zero KG tools as if the capability did not exist.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# ── Pinned baseline profile ─────────────────────────────────────────────
# Force-set/unset (never setdefault/leave-ambient) so this script's output
# does not depend on the caller's shell. Every conditional slot factory in
# middleware_slots.py reads one of these.
_PROFILE: dict[str, str | None] = {
    "RAPTIX_PLUGINS": "__tool_eval_baseline_capture__",  # no plugin bundles active
    "RAPTIX_USE_SKILLOGY": "1",  # Skillogy is the default backend (3 tools, not legacy's 1)
    "RAPTIX_HITL__ENABLED": None,  # HITL off — HITL slot is not in any OSS role's tool-bearing set anyway
    "RAPTIX_KG_AUTOINGEST": None,  # off — KG_AUTOINGEST never exposes tools regardless
    "RAPTIX_KG_OPERATIONAL_SHADOW": None,  # off
    "RAPTIX_RUNTIME__RECORD_PATH": None,  # RecordingMiddleware off
}
for _k, _v in _PROFILE.items():
    if _v is None:
        os.environ.pop(_k, None)
    else:
        os.environ[_k] = _v

_ROLE_MODULES: tuple[str, ...] = (
    "raptix.intelligence.agents.standard.raptix",
    "raptix.intelligence.agents.standard.soundwave",
    "raptix.intelligence.agents.standard.blue_cell",
    "raptix.intelligence.agents.standard.recon",
    "raptix.intelligence.agents.standard.exploit",
    "raptix.intelligence.agents.standard.postexploit",
    "raptix.intelligence.agents.standard.surface_exploit",
    "raptix.intelligence.agents.standard.analyst",
    "raptix.intelligence.agents.standard.forensicator",
    "raptix.intelligence.agents.standard.osint_operator",
    "raptix.intelligence.agents.standard.supply_chain_operator",
)

# Slots whose factory needs a live model/backend this script cannot
# provide, and which never contribute tools anyway. Skipped outright
# rather than attempted-then-caught, since a few (SUMMARIZATION) probe a
# live BaseChatModel at construction time (``model.profile``), not just at
# call time — a MagicMock raises AttributeError-shaped nonsense instead of
# a clean "slot skipped".
_SKIP_SLOTS = {"summarization", "model-fallback", "prompt-caching"}

# Statically-known tool names for slots that degrade to None without a
# live backend in THIS dev environment, sourced from
# docs/architecture/tool-classification.md (not guessed) — so a row never
# silently implies "this role has no KG tools" when the real reason is
# "no Neo4j is configured here".
_KNOWN_TOOLS_WHEN_UNAVAILABLE = {
    ("kg", "raptix"): ["kg_surface_inventory"],
    ("kg", "*"): ["kg_record", "kg_ingest"],
    # SubAgentMiddleware's internal subagent-spec validation goes deeper than
    # this capture script's dummy entry can satisfy without a real bound
    # chat model (deepagents validates token/context-window fields on
    # ``model``). The tool itself is unconditional — exactly one ``task``
    # tool regardless of which subagents are registered — so it is recorded
    # as statically known rather than chasing deepagents' internals further.
    ("subagent", "*"): ["task"],
}

_OUTPUT = Path(__file__).parent / "assembled_baseline.jsonl"


def _tool_name(tool) -> str:
    name = getattr(tool, "name", None)
    return name if isinstance(name, str) and name else getattr(tool, "__name__", repr(tool))


def _capture_role(module_name: str) -> dict:
    import importlib

    from raptix.intelligence.agents import build as build_module
    from raptix.intelligence.agents.build import build_tools
    from raptix.intelligence.agents.middleware_slots import DEFAULT_SLOT_FACTORIES, MiddlewareSlot
    from raptix.intelligence.agents.tool_exposure import summarize_tool_exposure
    from raptix.middleware.skillogy import maybe_install_skillogy
    from raptix_core import plugin_loader
    from raptix_core.contracts.slots import SLOTS_PER_ROLE

    mod = importlib.import_module(module_name)
    role = mod._ROLE  # noqa: SLF001

    if role == "raptix":
        from raptix.execution.tools.ops import OPS_TOOLS, ops_available

        static_dict = {t.name: t for t in OPS_TOOLS} if ops_available() else {}
    else:
        static_dict = mod._STANDARD_TOOLS  # noqa: SLF001

    with patch.object(build_module, "entry_points", return_value=[]):
        with patch.object(plugin_loader, "entry_points", return_value=[]):
            static_tools = build_tools(role=role, standard_tools=static_dict)

    role_slots = SLOTS_PER_ROLE[role]
    middleware_tools: dict[str, list[str]] = {}
    skipped_slots: dict[str, str] = {}
    backend = MagicMock(name="backend")
    sandbox = MagicMock(name="sandbox")

    for slot in MiddlewareSlot:
        if slot not in role_slots or slot.value in _SKIP_SLOTS:
            continue
        factory = DEFAULT_SLOT_FACTORIES[slot]
        try:
            instance = factory(
                backend=backend,
                llm=MagicMock(name="llm"),
                role=role,
                fallback_models=None,
                sandbox=sandbox,
                # SubAgentMiddleware.__init__ raises on an empty list ("at least
                # one subagent must be specified") and needs a real SubAgent-
                # shaped dict (name/description/model) — a dummy entry is
                # enough to get past construction; the resulting `task` tool's
                # name/schema does not depend on which subagents are
                # registered.
                subagents=[
                    {
                        "name": "dummy",
                        "description": "dummy",
                        "model": MagicMock(name="dummy_model"),
                        "tools": [],
                        "prompt": "dummy",
                    }
                ],
                skill_sources=None,
            )
        except Exception as exc:  # noqa: BLE001 — this is a capture script, record and move on
            skipped_slots[slot.value] = f"factory raised: {exc!r}"
            known = _KNOWN_TOOLS_WHEN_UNAVAILABLE.get(
                (slot.value, role), _KNOWN_TOOLS_WHEN_UNAVAILABLE.get((slot.value, "*"))
            )
            if known:
                middleware_tools[slot.value] = known
                skipped_slots[slot.value] += f"; statically known tools: {known}"
            continue
        if instance is None:
            reason = (
                "factory returned None (slot's own precondition unmet in this environment/profile)"
            )
            skipped_slots[slot.value] = reason
            known = _KNOWN_TOOLS_WHEN_UNAVAILABLE.get(
                (slot.value, role), _KNOWN_TOOLS_WHEN_UNAVAILABLE.get((slot.value, "*"))
            )
            if known:
                middleware_tools[slot.value] = known
                skipped_slots[slot.value] += f"; statically known tools (no Neo4j here): {known}"
            continue
        if slot is MiddlewareSlot.SKILLS:
            (instance,) = maybe_install_skillogy([instance], role=role, skill_sources=None)
        tools = getattr(instance, "tools", None) or []
        if tools:
            middleware_tools[slot.value] = sorted({_tool_name(t) for t in tools})

    final_names: list[str] = [t.name for t in static_tools]
    for names in middleware_tools.values():
        final_names.extend(names)
    unique_final = sorted(set(final_names))

    static_summary = summarize_tool_exposure(role, static_tools)

    return {
        "role": role,
        "module": module_name,
        "baseline_scope": "assembled_core_surface",
        "static": {"count": len(static_tools), "tools": sorted(t.name for t in static_tools)},
        "middleware": middleware_tools,
        "skipped_slots": skipped_slots,
        "final": {
            "tool_entries_count": len(final_names),
            "unique_tool_names_count": len(unique_final),
            "tool_names": unique_final,
            "schema_chars_static_only": static_summary["tool_schema_chars"],
        },
        "dynamic_external_surfaces": [],  # plugin-loaded MCP bridges — never captured here
    }


def main() -> int:
    import subprocess
    from datetime import datetime, timezone

    try:
        git_commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            cwd=Path(__file__).parents[3],
        ).stdout.strip()
    except Exception:  # noqa: BLE001
        git_commit = None

    meta = {
        "_meta": True,
        "baseline_profile": _PROFILE,
        "git_commit": git_commit,
        "python_version": sys.version.split()[0],
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "note": (
            "middleware tool names are read generically via getattr(instance, 'tools', []) "
            "on every slot factory's output, not a hardcoded 'only KGMiddleware injects tools' "
            "assumption. skipped_slots explains any slot that returned None in this environment."
        ),
    }
    rows = [meta] + [_capture_role(m) for m in _ROLE_MODULES]

    _OUTPUT.write_text(
        "\n".join(json.dumps(r, sort_keys=True) for r in rows) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(rows) - 1} role baselines + 1 meta header to {_OUTPUT}")
    for r in rows[1:]:
        mw_count = sum(len(v) for v in r["middleware"].values())
        print(
            f"  {r['role']:<24} static={r['static']['count']:>3}  middleware={mw_count:>3}  "
            f"final_unique={r['final']['unique_tool_names_count']:>3}  "
            f"skipped={sorted(r['skipped_slots'])}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
