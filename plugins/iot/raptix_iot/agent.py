"""IoT operator identity and baseline capability declaration."""

from raptix_sdk import DomainAgentDefinition, PromptResource, domain_subagent

DEFINITION = DomainAgentDefinition(
    role="iot_operator",
    description=(
        "IoT / embedded-device attack specialist. Use when scope "
        "includes IoT or embedded hardware: firmware acquisition + "
        "binwalk extraction, hardcoded-credential discovery, bootloader "
        "(U-Boot) and /dev/mem attacks, and wireless radios (BLE GATT, "
        "Zigbee Touchlink, Z-Wave, sub-GHz, LoRaWAN). Existing skill "
        "tree at skills/standard/iot/."
    ),
    tool_names=(
        "search_knowledge",
        "inspect_asset",
        "cve_lookup",
        "lookup_payload",
        "search_security_references",
        "bash",
        "bash_output",
        "bash_kill",
        "bash_status",
    ),
    skill_sources=("/skills/standard/iot/", "/skills/shared/"),
    priority=58,
)
SUBAGENT_SPEC = domain_subagent(DEFINITION)
create_iot_operator_agent = SUBAGENT_SPEC.factory
PROMPTS = (PromptResource("iot_operator", "raptix_iot", "prompts/iot_operator.md"),)
