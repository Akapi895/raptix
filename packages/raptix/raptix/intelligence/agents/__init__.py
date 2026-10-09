# Standard bundle — raptix main agent + 16 official subagents + soundwave.
# Plugins bundle — vulnresearch main agent + its 5 subagents (community-plugin
# shape demonstrated from inside OSS). See raptix/intelligence/agents/plugins/__init__.py.
# The nine domain specialists are plugin-owned since W10; their factories
# import from the domain packs directly.
from importlib import import_module
from typing import Any

_DOMAINS = {
    "ad_operator": "active_directory",
    "cloud_hunter": "cloud",
    "contract_auditor": "contracts",
    "ics_operator": "ics",
    "iot_operator": "iot",
    "mobile_operator": "mobile",
    "phisher": "phishing",
    "reverser": "reversing",
    "wireless_operator": "wireless",
}
_PLUGINS = {"detector", "exploiter", "patcher", "scanner", "verifier", "vulnresearch"}


def __getattr__(name: str) -> Any:
    if name not in __all__:
        raise AttributeError(name)
    role = name.removeprefix("create_").removesuffix("_agent")
    module = (
        f"raptix_{_DOMAINS[role]}.agent"
        if role in _DOMAINS
        else f"{__name__}.{'plugins' if role in _PLUGINS else 'standard'}.{role}"
    )
    value = getattr(import_module(module), name)
    globals()[name] = value
    return value


__all__ = [
    "create_recon_agent",
    "create_autohunt_agent",
    "create_soundwave_agent",
    "create_analyst_agent",
    "create_exploit_agent",
    "create_surface_exploit_agent",
    "create_postexploit_agent",
    "create_raptix_agent",
    "create_reverser_agent",
    "create_contract_auditor_agent",
    "create_cloud_hunter_agent",
    "create_ad_operator_agent",
    "create_phisher_agent",
    "create_mobile_operator_agent",
    "create_wireless_operator_agent",
    "create_blue_cell_agent",
    # WAVE-3 specialists — lit up over the pre-existing skill trees.
    "create_osint_operator_agent",
    "create_iot_operator_agent",
    "create_ics_operator_agent",
    "create_forensicator_agent",
    "create_supply_chain_operator_agent",
    # Vulnresearch pipeline (five-stage modular)
    "create_scanner_agent",
    "create_detector_agent",
    "create_verifier_agent",
    "create_patcher_agent",
    "create_exploiter_agent",
    "create_vulnresearch_agent",
]
