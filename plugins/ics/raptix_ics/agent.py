"""ICS operator declaration retaining the existing RoE-gated identity."""

from raptix_sdk import DomainAgentDefinition, PromptResource, domain_subagent

DEFINITION = DomainAgentDefinition(
    role="ics_operator",
    description=(
        "ICS / OT / SCADA attack specialist (Modbus, DNP3, S7comm, "
        "BACnet, OPC-UA). HIGHLY DESTRUCTIVE: mandates a hard "
        "Rules-of-Engagement authorization gate before ANY active "
        "interaction and confines control writes to a lab or authorized "
        "canary. Read-only enumeration first. Existing skill tree at "
        "skills/standard/ics/."
    ),
    tool_names=(
        "search_knowledge",
        "inspect_asset",
        "cve_lookup",
        "payload_search",
        "methodology_lookup",
        "bash",
        "bash_output",
        "bash_kill",
        "bash_status",
    ),
    skill_sources=("/skills/standard/ics/", "/skills/shared/"),
    priority=92,
)
SUBAGENT_SPEC = domain_subagent(DEFINITION)
create_ics_operator_agent = SUBAGENT_SPEC.factory
PROMPTS = (PromptResource("ics_operator", "raptix_ics", "prompts/ics_operator.md"),)
