"""Wireless operator identity and capability declaration."""

from raptix_sdk import DomainAgentDefinition, PromptResource, domain_subagent

DEFINITION = DomainAgentDefinition(
    role="wireless_operator",
    description=(
        "Wi-Fi / BLE / Zigbee / sub-GHz wireless specialist. Use when "
        "the engagement scope includes wireless attack surfaces: "
        "WPA2-PSK handshake / PMKID capture + hashcat, WPA3-SAE "
        "downgrade, WPA-Enterprise evil-twin RADIUS, evil-twin / KARMA "
        "/ Mana, deauth / disassoc, WPS Pixie Dust, BLE GATT, Zigbee "
        "Touchlink, sub-GHz replay. Requires hardware passthrough or "
        "an SSH dropbox - see prompts/workflows/wireless_operator.md."
    ),
    tool_names=("methodology_lookup", "bash", "bash_output", "bash_kill", "bash_status"),
    skill_sources=("/skills/standard/wireless/", "/skills/shared/"),
    recursion_limit=200,
    priority=85,
)
SUBAGENT_SPEC = domain_subagent(DEFINITION)
create_wireless_operator_agent = SUBAGENT_SPEC.factory
PROMPTS = (
    PromptResource("wireless_operator", "raptix_wireless", "prompts/wireless_operator.md"),
    PromptResource(
        "wireless_operator",
        "raptix_wireless",
        "prompts/workflows/wireless_operator.md",
        workflow=True,
    ),
)
