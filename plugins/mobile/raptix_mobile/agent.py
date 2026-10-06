"""Mobile operator identity and baseline capability declaration."""

from raptix_sdk import DomainAgentDefinition, PromptResource, domain_subagent

DEFINITION = DomainAgentDefinition(
    role="mobile_operator",
    description=(
        "Android / iOS application attack specialist. Use when the "
        "engagement scope includes mobile apps: static analysis "
        "(apktool/jadx/class-dump), dynamic instrumentation "
        "(frida/objection), SSL pinning + root/jailbreak detection "
        "bypass, exported-component abuse, WebView JavaScript bridge "
        "exploitation, and MobSF integration. Existing skill tree at "
        "skills/standard/mobile/."
    ),
    tool_names=(
        "lookup_payload",
        "search_security_references",
        "cve_lookup",
        "bash",
        "bash_output",
        "bash_kill",
        "bash_status",
    ),
    skill_sources=("/skills/standard/mobile/", "/skills/shared/"),
    priority=55,
)
SUBAGENT_SPEC = domain_subagent(DEFINITION)
create_mobile_operator_agent = SUBAGENT_SPEC.factory
PROMPTS = (
    PromptResource("mobile_operator", "raptix_mobile", "prompts/mobile_operator.md"),
    PromptResource(
        "mobile_operator", "raptix_mobile", "prompts/workflows/mobile_operator.md", workflow=True
    ),
)
