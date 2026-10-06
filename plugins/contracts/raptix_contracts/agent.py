"""Contract-auditor declaration; execution is composed through the SDK."""

from raptix_sdk import DomainAgentDefinition, PromptResource, domain_subagent

DEFINITION = DomainAgentDefinition(
    role="contract_auditor",
    description=(
        "Solidity / EVM smart contract audit specialist. Use for DeFi / "
        "smart-contract engagements: reentrancy, oracle manipulation, flash "
        "loan abuse, access control gaps, upgradeable proxies, signature "
        "replay. Runs Slither ingestion, solidity pattern scanner, and "
        "Foundry PoC test harness generation."
    ),
    tool_names=(
        "solidity_scan",
        "solidity_scan_file",
        # Wave T4: one Slither ingest path — kg_ingest_slither carries
        # the capability now (slither_ingest is an plain internal service).
        "kg_ingest_slither",
        "foundry_reentrancy_test",
        "foundry_access_test",
        "foundry_flashloan_test",
        "bash",
        "bash_output",
        "bash_kill",
        "bash_status",
    ),
    skill_sources=("/skills/standard/contracts/", "/skills/shared/"),
    recursion_limit=1000,
    priority=50,
)
SUBAGENT_SPEC = domain_subagent(DEFINITION)
create_contract_auditor_agent = SUBAGENT_SPEC.factory
PROMPTS = (PromptResource("contract_auditor", "raptix_contracts", "prompts/contract_auditor.md"),)
