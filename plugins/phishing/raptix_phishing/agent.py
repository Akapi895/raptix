"""Phisher declaration retaining pre-send deconfliction requirements."""

from raptix_sdk import DomainAgentDefinition, PromptResource, domain_subagent

DEFINITION = DomainAgentDefinition(
    role="phisher",
    description=(
        "Initial-access specialist via phishing / social engineering "
        "(MITRE T1566.*). Use when the engagement's INITIAL_ACCESS "
        "objective requires user interaction - email phishing, "
        "evilginx2 token capture, M365 OAuth device-code, lookalike "
        "domain registration. Always coordinates the lure-deconfliction "
        "handshake with the blue team via plan/roe.json before sending."
    ),
    tool_names=(
        "lookup_payload",
        "search_security_references",
        "web_search",
        "web_fetch",
        "bash",
        "bash_output",
        "bash_kill",
        "bash_status",
    ),
    skill_sources=("/skills/standard/phisher/", "/skills/shared/"),
    priority=15,
)
SUBAGENT_SPEC = domain_subagent(DEFINITION)
create_phisher_agent = SUBAGENT_SPEC.factory
PROMPTS = (
    PromptResource("phisher", "raptix_phishing", "prompts/phisher.md"),
    PromptResource("phisher", "raptix_phishing", "prompts/workflows/phisher.md", workflow=True),
)
