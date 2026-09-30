"""LangGraph Platform graph registry — OSS built-ins merged with plugins.

LangGraph Platform expects a graph manifest (``langgraph.json``) or the
``LANGSERVE_GRAPHS`` environment variable mapping each graph name to a
``module:attr`` path. Decepticon's built-in agents are listed in the
``langgraph.json`` shipped with the repo. External packages add their own
agents by declaring entry-points in the ``raptix.agents`` group.

This module produces a merged manifest at runtime so external plugins
(e.g. a downstream plugin package shipped separately) can extend the available
graphs without editing ``langgraph.json``.

Typical usage in a container startup script:

    LANGSERVE_GRAPHS="$(python -m raptix.graph_registry)" \\
        langgraph dev --host 0.0.0.0 --port 2024
"""

from __future__ import annotations

import json

from raptix_core.plugin_loader import is_bundle_enabled, load_plugin_agents

# Built-in graphs split by bundle. ``build_langserve_graphs`` merges only
# the bundles active under RAPTIX_PLUGINS / config file (see
# ``raptix_core.plugin_loader._enabled_bundles``). External plugin
# packages register agents under the ``raptix.agents`` entry-point
# group and are always loaded when installed.

# Standard bundle — official OSS main agent + subagents + soundwave.
STANDARD_GRAPHS: dict[str, str] = {
    "decepticon": "./raptix/agents/standard/decepticon.py:graph",
    "recon": "./raptix/agents/standard/recon.py:graph",
    "autohunt": "./raptix/agents/standard/autohunt.py:graph",
    "soundwave": "./raptix/agents/standard/soundwave.py:graph",
    "exploit": "./raptix/agents/standard/exploit.py:graph",
    "surface_exploit": "./raptix/agents/standard/surface_exploit.py:graph",
    "postexploit": "./raptix/agents/standard/postexploit.py:graph",
    "analyst": "./raptix/agents/standard/analyst.py:graph",
    "reverser": "./raptix/agents/standard/reverser.py:graph",
    "contract_auditor": "./raptix/agents/standard/contract_auditor.py:graph",
    "cloud_hunter": "./raptix/agents/standard/cloud_hunter.py:graph",
    "ad_operator": "./raptix/agents/standard/ad_operator.py:graph",
    "blue_cell": "./raptix/agents/standard/blue_cell.py:graph",
    "phisher": "./raptix/agents/standard/phisher.py:graph",
    "mobile_operator": "./raptix/agents/standard/mobile_operator.py:graph",
    "wireless_operator": "./raptix/agents/standard/wireless_operator.py:graph",
    "osint_operator": "./raptix/agents/standard/osint_operator.py:graph",
    "iot_operator": "./raptix/agents/standard/iot_operator.py:graph",
    "ics_operator": "./raptix/agents/standard/ics_operator.py:graph",
    "forensicator": "./raptix/agents/standard/forensicator.py:graph",
    "supply_chain_operator": "./raptix/agents/standard/supply_chain_operator.py:graph",
}

# Plugins bundle — vulnresearch family (community-plugin shape demonstrated
# from inside OSS). Opt-in via ``RAPTIX_PLUGINS=standard,plugins`` or
# ``[plugins] enabled = ["standard", "plugins"]`` in ``.raptix.toml``.
PLUGIN_GRAPHS: dict[str, str] = {
    "vulnresearch": "./raptix/agents/plugins/vulnresearch.py:graph",
    "scanner": "./raptix/agents/plugins/scanner.py:graph",
    "detector": "./raptix/agents/plugins/detector.py:graph",
    "verifier": "./raptix/agents/plugins/verifier.py:graph",
    "patcher": "./raptix/agents/plugins/patcher.py:graph",
    "exploiter": "./raptix/agents/plugins/exploiter.py:graph",
}

# Mapping from bundle name to its graph dict — used by build_langserve_graphs.
_BUNDLE_TO_GRAPHS: dict[str, dict[str, str]] = {
    "standard": STANDARD_GRAPHS,
    "plugins": PLUGIN_GRAPHS,
}

# Backward-compat alias — full unfiltered manifest (every OSS-shipped graph).
# Prefer ``build_langserve_graphs()`` which respects RAPTIX_PLUGINS.
BUILTIN_GRAPHS: dict[str, str] = {**STANDARD_GRAPHS, **PLUGIN_GRAPHS}


def build_langserve_graphs() -> dict[str, str]:
    """Return ``{name: module:graph}`` for active bundles + discovered plugins.

    OSS-internal bundles (``standard``, ``plugins``) are filtered by
    ``RAPTIX_PLUGINS`` / config-file allowlist. Plugin-contributed
    agents (registered under the ``raptix.agents`` entry-point group
    by external packages) are always merged in — installing the package
    is the user's opt-in.

    Name collisions: plugin-contributed agents override built-in entries.
    """
    merged: dict[str, str] = {}
    for bundle_name, graphs in _BUNDLE_TO_GRAPHS.items():
        if is_bundle_enabled(bundle_name):
            merged.update(graphs)
    merged.update(load_plugin_agents())
    return merged


def emit_langserve_env() -> str:
    """Serialize the merged manifest as compact JSON for ``LANGSERVE_GRAPHS``."""
    return json.dumps(build_langserve_graphs(), separators=(",", ":"))


def main() -> None:
    """CLI entry: print the merged graph manifest as JSON to stdout."""
    print(emit_langserve_env())


if __name__ == "__main__":
    main()
