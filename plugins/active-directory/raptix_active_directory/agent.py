"""AD operator declaration; graph lifecycle remains a runtime adapter."""

from raptix_sdk import DomainAgentDefinition, PromptResource, domain_subagent

DEFINITION = DomainAgentDefinition(
    role="ad_operator",
    description=(
        "Active Directory / Windows attack specialist. Use after initial "
        "internal foothold: BloodHound ingestion, Kerberoast / AS-REP roast, "
        "ADCS ESC1-ESC15 scanning, DCSync candidate detection, and multi-hop "
        "AD attack path planning. Complements postexploit for Windows "
        "engagements."
    ),
    tool_names=(
        "bh_ingest_zip",
        "bh_ingest_json",
        "dcsync_check",
        "kerberos_classify",
        "adcs_audit",
        "adcs_post_process",
        "delegation_audit",
        "gpo_audit",
        "shadow_creds_audit",
        "bhce_status",
        "bhce_cypher",
        "bhce_ingest_zip",
        "killchain_lookup",
        "bash",
        "bash_output",
        "bash_kill",
        "bash_status",
    ),
    skill_sources=("/skills/standard/ad/", "/skills/shared/"),
    recursion_limit=1000,
    priority=70,
)
SUBAGENT_SPEC = domain_subagent(DEFINITION)
create_ad_operator_agent = SUBAGENT_SPEC.factory
PROMPTS = (PromptResource("ad_operator", "raptix_active_directory", "prompts/ad_operator.md"),)
