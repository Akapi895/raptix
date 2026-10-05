"""Reverser declaration; runtime-owned transports retain their boundaries."""

from raptix_sdk import DomainAgentDefinition, PromptResource, domain_subagent

DEFINITION = DomainAgentDefinition(
    role="reverser",
    description=(
        "Binary reversing specialist. Use for ELF/PE/Mach-O/firmware triage, "
        "packer detection, classified string extraction, symbol risk reports, "
        "ROP gadget inventories, and Radare2-assisted basic triage without the reversing workload. "
        "Use Ghidra headless + MCP bridge only for deep decompilation, "
        "cross-references, P-code emulation, batch analysis, and 245-tool workflows. "
        "Ideal for thick clients, IoT firmware, game cheats, malware triage, "
        "and exploit dev hand-offs."
    ),
    tool_names=(
        "bin_identify",
        "bin_strings",
        "bin_packer",
        "bin_rop",
        "bin_symbols_report",
        "bin_ghidra_script",
        "bin_r2_script",
        "ghidra_analyze",
        "ghidra_decompile",
        "ghidra_xrefs",
        "ghidra_status",
        "re_status",
        "bash",
        "bash_output",
        "bash_kill",
        "bash_status",
    ),
    recursion_limit=1000,
    priority=40,
)
SUBAGENT_SPEC = domain_subagent(DEFINITION)
create_reverser_agent = SUBAGENT_SPEC.factory
PROMPTS = (PromptResource("reverser", "raptix_reversing", "prompts/reverser.md"),)
