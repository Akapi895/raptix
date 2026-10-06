"""Wave T13 drift guards — domain pluginization.

Pins the physical move: the defense/reversing/active-directory domain
modules whose canonical homes are now plugin packages are re-exported
IDENTICALLY through their historical ``raptix.execution.tools.*`` import
paths (the never-delete rule), and the plugin workspace membership that
makes the canonical imports resolvable stays configured.
"""

from __future__ import annotations

from pathlib import Path

import raptix_active_directory.bhce_client as bhce_canonical
import raptix_reversing.ghidra as ghidra_canonical
from raptix_defense import conops, edr, elastic, sentinel, splunk

import raptix.execution.tools.ad.bhce_client as ad_shim
import raptix.execution.tools.defense.conops as conops_shim
import raptix.execution.tools.defense.edr as edr_shim
import raptix.execution.tools.defense.elastic as elastic_shim
import raptix.execution.tools.defense.sentinel as sentinel_shim
import raptix.execution.tools.defense.splunk as splunk_shim
import raptix.execution.tools.reversing.ghidra as ghidra_shim

REPO_ROOT = Path(__file__).parents[5]


def _identity(a: object, b: object) -> None:
    assert a is b


def test_ghidra_bridge_is_owned_by_the_reversing_plugin() -> None:
    _identity(ghidra_shim.GhidraAnalysis, ghidra_canonical.GhidraAnalysis)
    _identity(ghidra_shim.GhidraFunction, ghidra_canonical.GhidraFunction)
    _identity(ghidra_shim.ghidra_analyze_binary, ghidra_canonical.ghidra_analyze_binary)
    _identity(ghidra_shim.ghidra_available, ghidra_canonical.ghidra_available)
    _identity(ghidra_shim.ghidra_decompile_function, ghidra_canonical.ghidra_decompile_function)
    _identity(ghidra_shim.ghidra_get_xrefs, ghidra_canonical.ghidra_get_xrefs)


def test_bhce_client_is_owned_by_the_active_directory_plugin() -> None:
    _identity(ad_shim.BHCEClient, bhce_canonical.BHCEClient)
    _identity(ad_shim.BHCEConfigError, bhce_canonical.BHCEConfigError)
    _identity(ad_shim.BHCEHTTPError, bhce_canonical.BHCEHTTPError)
    _identity(ad_shim.sign_request, bhce_canonical.sign_request)


def test_defense_builders_are_owned_by_the_defense_plugin() -> None:
    _identity(conops_shim.resolve_siem_target, conops.resolve_siem_target)
    _identity(conops_shim.list_targets, conops.list_targets)
    _identity(conops_shim.resolve_auth_value, conops.resolve_auth_value)
    _identity(conops_shim.engagement_slug, conops.engagement_slug)
    _identity(edr_shim.push_defender_xdr_detection, edr.push_defender_xdr_detection)
    _identity(edr_shim.push_crowdstrike_ioa, edr.push_crowdstrike_ioa)
    _identity(elastic_shim.sigma_to_lucene, elastic.sigma_to_lucene)
    _identity(elastic_shim.push_detection_rule, elastic.push_detection_rule)
    _identity(sentinel_shim.sigma_to_kql, sentinel.sigma_to_kql)
    _identity(sentinel_shim.push_analytic_rule, sentinel.push_analytic_rule)
    _identity(splunk_shim.sigma_to_spl, splunk.sigma_to_spl)
    _identity(splunk_shim.push_savedsearch, splunk.push_savedsearch)


def test_private_names_stay_reachable_through_the_shims() -> None:
    """Tests (and only tests) reach a few private helpers through the old
    paths — the shims carry them so the never-delete rule holds for the
    whole surface, not just the public names."""
    _identity(ghidra_shim._GHIDRA_FUNC_KEYS, ghidra_canonical._GHIDRA_FUNC_KEYS)
    _identity(edr_shim._YARA_META_PATTERN, edr._YARA_META_PATTERN)


def test_defense_plugin_is_a_workspace_member() -> None:
    pyproject = REPO_ROOT / "plugins" / "defense" / "pyproject.toml"
    assert pyproject.is_file()
    content = pyproject.read_text(encoding="utf-8")
    assert 'packages = ["raptix_defense"]' in content
    # The runtime declares the pack so its import graph is honest.
    runtime_pyproject = (REPO_ROOT / "packages" / "raptix" / "pyproject.toml").read_text(
        encoding="utf-8"
    )
    assert '"raptix-defense"' in runtime_pyproject


def test_moved_modules_carry_no_runtime_imports() -> None:
    """The plugin-owned modules import stdlib/plugin-local only — the
    runtime deps (KGStore, langchain) stay on the runtime side of the
    boundary."""
    moved = [
        REPO_ROOT / "plugins" / "reversing" / "raptix_reversing" / "ghidra.py",
        REPO_ROOT / "plugins" / "active-directory" / "raptix_active_directory" / "bhce_client.py",
        *(
            REPO_ROOT / "plugins" / "defense" / "raptix_defense" / f"{name}.py"
            for name in ("conops", "edr", "elastic", "sentinel", "splunk")
        ),
    ]
    for path in moved:
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not (stripped.startswith("from ") or stripped.startswith("import ")):
                continue
            assert "raptix.execution" not in stripped and "raptix.knowledge" not in stripped, (
                f"{path.name}: runtime import leaked into a plugin module: {stripped}"
            )
            assert "langchain" not in stripped, (
                f"{path.name}: langchain import leaked into a plugin module: {stripped}"
            )
