# Standard bundle — raptix main agent + 16 official subagents + soundwave.
# Plugins bundle — vulnresearch main agent + its 5 subagents (community-plugin
# shape demonstrated from inside OSS). See raptix/intelligence/agents/plugins/__init__.py.
from raptix.intelligence.agents.plugins.detector import create_detector_agent
from raptix.intelligence.agents.plugins.exploiter import create_exploiter_agent
from raptix.intelligence.agents.plugins.patcher import create_patcher_agent
from raptix.intelligence.agents.plugins.scanner import create_scanner_agent
from raptix.intelligence.agents.plugins.verifier import create_verifier_agent
from raptix.intelligence.agents.plugins.vulnresearch import create_vulnresearch_agent
from raptix.intelligence.agents.standard.ad_operator import create_ad_operator_agent
from raptix.intelligence.agents.standard.analyst import create_analyst_agent
from raptix.intelligence.agents.standard.autohunt import create_autohunt_agent
from raptix.intelligence.agents.standard.blue_cell import create_blue_cell_agent
from raptix.intelligence.agents.standard.cloud_hunter import create_cloud_hunter_agent
from raptix.intelligence.agents.standard.contract_auditor import create_contract_auditor_agent
from raptix.intelligence.agents.standard.decepticon import create_decepticon_agent
from raptix.intelligence.agents.standard.exploit import create_exploit_agent
from raptix.intelligence.agents.standard.forensicator import create_forensicator_agent
from raptix.intelligence.agents.standard.ics_operator import create_ics_operator_agent
from raptix.intelligence.agents.standard.iot_operator import create_iot_operator_agent
from raptix.intelligence.agents.standard.mobile_operator import create_mobile_operator_agent
from raptix.intelligence.agents.standard.osint_operator import create_osint_operator_agent
from raptix.intelligence.agents.standard.phisher import create_phisher_agent
from raptix.intelligence.agents.standard.postexploit import create_postexploit_agent
from raptix.intelligence.agents.standard.recon import create_recon_agent
from raptix.intelligence.agents.standard.reverser import create_reverser_agent
from raptix.intelligence.agents.standard.soundwave import create_soundwave_agent
from raptix.intelligence.agents.standard.supply_chain_operator import (
    create_supply_chain_operator_agent,
)
from raptix.intelligence.agents.standard.surface_exploit import create_surface_exploit_agent
from raptix.intelligence.agents.standard.wireless_operator import create_wireless_operator_agent

__all__ = [
    "create_recon_agent",
    "create_autohunt_agent",
    "create_soundwave_agent",
    "create_analyst_agent",
    "create_exploit_agent",
    "create_surface_exploit_agent",
    "create_postexploit_agent",
    "create_decepticon_agent",
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
