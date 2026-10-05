"""Installed first-party packs retain the SDK-only dependency boundary."""

import ast
import subprocess
import sys
from pathlib import Path

from raptix_sdk import installed_domain_packs

DOMAIN_NAMES = {
    "contracts",
    "reversing",
    "mobile",
    "iot",
    "ics",
    "wireless",
    "cloud",
    "phishing",
    "active-directory",
    "web",
    "network",
}


def test_all_planned_domain_packs_are_discoverable() -> None:
    assert {pack.name for pack in installed_domain_packs()} == DOMAIN_NAMES


def test_plugin_sources_do_not_import_framework_or_runtime_implementations() -> None:
    allowed = sys.stdlib_module_names | {"raptix_sdk", "raptix_core"}
    allowed |= {pack.package for pack in installed_domain_packs()}
    root = Path(__file__).resolve().parents[1]
    for source in root.glob("*/raptix_*/*.py"):
        for node in ast.walk(ast.parse(source.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                assert all(alias.name.split(".")[0] in allowed for alias in node.names), source
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                assert node.module.split(".")[0] in allowed, source


def test_all_domain_metadata_loads_without_loading_runtime_or_frameworks() -> None:
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; from importlib.metadata import entry_points; "
            "from raptix_sdk import installed_domain_packs; "
            "packs=installed_domain_packs(); assert len(packs)==11; "
            "roles={r for p in packs for r in p.roles}; "
            "specs=[e.load() for e in entry_points(group='raptix.subagents') if e.name in roles]; "
            "assert len(specs)==9; "
            "assert not any(n=='raptix' or n.startswith(('raptix.','langchain','langgraph','deepagents')) "
            "for n in sys.modules)",
        ],
        check=True,
    )
