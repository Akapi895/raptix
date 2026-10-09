"""T0a baseline capture — static ``build_tools()`` surface per OSS role.

Wave T0 of ``docs/tool-optimization-implementation-plan.md``. Renamed from
"T0" to "T0a" after the freeze review: this captures only the STATIC
``build_tools()`` surface (each role's ``_STANDARD_TOOLS``-equivalent
dict), not the full per-turn model-facing surface — see
``capture_assembled_baseline.py`` (T0b) for the static+middleware union.
Re-run after T1+ changes the surface and diff against this frozen file.

Run from the repo root:

    uv run python benchmarks/suites/tool_eval/baseline/capture_baseline.py

Writes ``benchmarks/suites/tool_eval/baseline/baseline.jsonl`` (one line per role).
Does not require network, sandbox, or API keys: importing the standard
agent modules only constructs ``@tool``-decorated callables and their
pydantic schemas, never a live agent. Module-level agent construction
(``graph = create_xxx_agent()``, gated by ``is_bundle_enabled("standard")``)
is suppressed by pinning ``RAPTIX_PLUGINS`` to a bundle name that does not
exist, so the import graph stays side-effect-free.

Determinism: ``RAPTIX_PLUGINS`` is force-set (not ``setdefault``) so this
script's output does not depend on the caller's ambient environment — the
whole point of a baseline is that it is reproducible on a different
machine/shell with a different ``RAPTIX_PLUGINS`` already exported.

Scope: this captures only the ``build_tools()``-governed static surface —
tools listed in each role's static tools dict. It does NOT include tools a
middleware slot injects at ``create_agent()`` time (e.g. the KG slot's
``kg_record``/``kg_ingest``/``kg_surface_inventory``, the OPPLAN slot's 7
tools, the SUBAGENT slot's ``task``, or a plugin-loaded MCP bridge). A
role's real per-turn tool count is higher than the number reported here —
see T0b for the assembled figure.
"""

from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

# Pinned baseline profile. Force-set (never setdefault): this script must
# produce the same output regardless of what the caller's shell already
# exports, or "the baseline" is not actually one thing.
os.environ["RAPTIX_PLUGINS"] = "__tool_eval_baseline_capture__"

# One (module, role) pair per OSS role with a module-level static-tools
# baseline. Excluded: ``autohunt`` (alternate factory for the same
# "soundwave" role — would duplicate that row). ``raptix`` is included with
# special handling below — its static surface is conditional (OPS_TOOLS
# only when ``ops_available()``), not a plain ``_STANDARD_TOOLS`` dict.
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

_OUTPUT = Path(__file__).parent / "baseline.jsonl"


def _git_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            cwd=Path(__file__).parents[4],
        )
        return out.stdout.strip()
    except Exception:  # noqa: BLE001 — metadata only, never fatal
        return None


def _raptix_version() -> str | None:
    try:
        from importlib.metadata import version

        return version("raptix")
    except Exception:  # noqa: BLE001
        return None


def _static_tools_for(role: str, mod) -> dict:
    """Mirror each factory's own static-tools construction (never guessed)."""
    if role == "raptix":
        from raptix.execution.tools.ops import OPS_TOOLS, ops_available

        return {t.name: t for t in OPS_TOOLS} if ops_available() else {}
    return mod._STANDARD_TOOLS  # noqa: SLF001 — intentional access to the module's static dict


def _capture_one(module_name: str, build_tools) -> dict:
    mod = importlib.import_module(module_name)
    role = mod._ROLE  # noqa: SLF001 — intentional access to the module's role constant
    standard_tools = _static_tools_for(role, mod)
    # No plugins installed in this dev environment, but patch both discovery
    # points anyway so the baseline is deterministic across machines.
    from raptix.intelligence.agents import build as build_module
    from raptix_core import plugin_loader

    with patch.object(build_module, "entry_points", return_value=[]):
        with patch.object(plugin_loader, "entry_points", return_value=[]):
            tools = build_tools(role=role, standard_tools=standard_tools)

    from raptix.intelligence.agents.tool_exposure import summarize_tool_exposure

    summary = summarize_tool_exposure(role, tools)
    summary["module"] = module_name
    summary["baseline_scope"] = "build_tools_static"
    names = summary["tool_names"]
    summary["tool_entries_count"] = len(tools)
    summary["unique_tool_names_count"] = len(set(names))
    if len(tools) != len(set(names)):
        from collections import Counter

        counts = Counter(t.name for t in tools)
        summary["duplicate_tool_names"] = sorted(n for n, c in counts.items() if c > 1)
    else:
        summary["duplicate_tool_names"] = []
    return summary


def main() -> int:
    from raptix.intelligence.agents.build import build_tools

    rows = [_capture_one(m, build_tools) for m in _ROLE_MODULES]
    captured_at = datetime.now(timezone.utc).isoformat()
    git_commit = _git_commit()
    raptix_version = _raptix_version()
    for row in rows:
        row["captured_at"] = captured_at
        row["git_commit"] = git_commit
        row["python_version"] = sys.version.split()[0]
        row["raptix_version"] = raptix_version

    _OUTPUT.write_text(
        "\n".join(json.dumps(row, sort_keys=True) for row in rows) + "\n",
        encoding="utf-8",
    )

    print(f"wrote {len(rows)} role baselines to {_OUTPUT} (git {git_commit})")
    for row in sorted(rows, key=lambda r: -r["active_tools_per_turn"]):
        dupe_note = f" dupes={row['duplicate_tool_names']}" if row["duplicate_tool_names"] else ""
        print(
            f"  {row['role']:<24} tools={row['active_tools_per_turn']:>3}  "
            f"schema_chars={row['tool_schema_chars']:>6}{dupe_note}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
