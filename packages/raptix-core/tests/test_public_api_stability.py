"""Stability snapshot — every public ``decepticon-core`` name imports.

Locks in the public surface so accidental removal / rename fails CI.
Spec §6.1 enumerates the SemVer-stable surface plugin authors and
downstream consumers can rely on at v1.0; this test asserts each
listed name is importable from its declared module.

To intentionally remove or rename a public name:
  1. Update this manifest in the same commit
  2. Update the CHANGELOG (and migration guide if the rename breaks
     callers)
  3. Bump the major version if at 1.0+
"""

from __future__ import annotations

import importlib
from typing import Any

import pytest

# (module, name) pairs. Every entry must resolve to an importable
# attribute. Reorganize by category for readability.
CORE_PUBLIC_API: tuple[tuple[str, str], ...] = (
    # raptix_core.types.engagement
    ("raptix_core.types.engagement", "RoE"),
    ("raptix_core.types.engagement", "OPPLAN"),
    ("raptix_core.types.engagement", "Finding"),
    ("raptix_core.types.engagement", "Evidence"),
    ("raptix_core.types.engagement", "Objective"),
    ("raptix_core.types.engagement", "AttackPath"),
    ("raptix_core.types.engagement", "ObjectivePhase"),
    ("raptix_core.types.engagement", "ObjectiveStatus"),
    ("raptix_core.types.engagement", "OpsecLevel"),
    ("raptix_core.types.engagement", "C2Tier"),
    ("raptix_core.types.engagement", "FindingSeverity"),
    ("raptix_core.types.engagement", "FindingConfidence"),
    ("raptix_core.types.engagement", "RemediationPriority"),
    ("raptix_core.types.engagement", "EngagementType"),
    ("raptix_core.types.engagement", "ScopeEntry"),
    ("raptix_core.types.engagement", "EscalationContact"),
    # raptix_core.types.llm
    ("raptix_core.types.llm", "Tier"),
    ("raptix_core.types.llm", "AuthMethod"),
    ("raptix_core.types.llm", "ModelProfile"),
    ("raptix_core.types.llm", "Credentials"),
    ("raptix_core.types.llm", "ProxyConfig"),
    ("raptix_core.types.llm", "ModelAssignment"),
    ("raptix_core.types.llm", "LLMModelMapping"),
    # raptix_core.types.kg
    ("raptix_core.types.kg", "Node"),
    ("raptix_core.types.kg", "Edge"),
    ("raptix_core.types.kg", "NodeKind"),
    ("raptix_core.types.kg", "EdgeKind"),
    ("raptix_core.types.kg", "Severity"),
    ("raptix_core.types.kg", "KnowledgeGraph"),
    # raptix_core.types.roe — machine-readable RoE enforcement schema
    ("raptix_core.types.roe", "EnforcementMode"),
    ("raptix_core.types.roe", "ScopeRule"),
    ("raptix_core.types.roe", "MachineEnforcement"),
    ("raptix_core.types.roe", "Decision"),
    ("raptix_core.types.roe", "evaluate_target"),
    ("raptix_core.types.roe", "evaluate_command"),
    # raptix_core.protocols
    ("raptix_core.protocols", "BackendProtocol"),
    ("raptix_core.protocols", "MiddlewareProtocol"),
    ("raptix_core.protocols", "ToolProtocol"),
    ("raptix_core.protocols", "CallbackProtocol"),
    ("raptix_core.protocols", "LLMProtocol"),
    ("raptix_core.protocols", "SandboxProtocol"),
    ("raptix_core.protocols", "AgentProtocol"),
    # raptix_core.contracts.slots
    ("raptix_core.contracts.slots", "MiddlewareSlot"),
    ("raptix_core.contracts.slots", "SAFETY_CRITICAL_SLOTS"),
    ("raptix_core.contracts.slots", "SLOTS_PER_ROLE"),
    # raptix_core.contracts.contributions
    ("raptix_core.contracts.contributions", "ToolContribution"),
    ("raptix_core.contracts.contributions", "MiddlewareContribution"),
    ("raptix_core.contracts.contributions", "PromptContribution"),
    ("raptix_core.contracts.contributions", "SubAgentContribution"),
    ("raptix_core.contracts.contributions", "SafetyDeclaration"),
    # raptix_core.registry
    ("raptix_core.registry", "PluginRegistry"),
    ("raptix_core.registry", "PluginInfo"),
    ("raptix_core.registry", "PluginConflictWarning"),
    ("raptix_core.registry", "RoleRegistry"),
    ("raptix_core.registry", "RoleSpec"),
    ("raptix_core.registry", "RoleResolution"),
    ("raptix_core.registry", "MiddlewareInfo"),
    ("raptix_core.registry", "ToolInfo"),
    ("raptix_core.registry", "OverrideInfo"),
    ("raptix_core.registry", "SafetyRegistry"),
    ("raptix_core.registry", "SkillSourceRegistry"),
    # raptix_core.plugin_loader (still here for back-compat;
    # contracts will eventually split into contracts/, registry/ per
    # spec §9.1 but the public symbol set stays the same).
    ("raptix_core.plugin_loader", "PluginBundle"),
    ("raptix_core.plugin_loader", "SubAgentSpec"),
    ("raptix_core.plugin_loader", "is_bundle_enabled"),
    ("raptix_core.plugin_loader", "load_plugin_tools"),
    ("raptix_core.plugin_loader", "load_plugin_middleware"),
    ("raptix_core.plugin_loader", "load_plugin_callbacks"),
    ("raptix_core.plugin_loader", "load_plugin_skill_sources"),
    ("raptix_core.plugin_loader", "load_subagents_for_parent"),
    ("raptix_core.plugin_loader", "load_plugin_agents"),
    # raptix_core.utils
    ("raptix_core.utils.config", "DecepticonConfig"),
    ("raptix_core.utils.config", "LLMConfig"),
    ("raptix_core.utils.config", "load_config"),
    ("raptix_core.utils.logging", "configure_logging"),
    ("raptix_core.utils.logging", "get_logger"),
)


@pytest.mark.parametrize(("module_name", "attr"), CORE_PUBLIC_API)
def test_public_name_importable(module_name: str, attr: str) -> None:
    """Each (module, name) in the manifest must resolve.

    Failures indicate accidental removal or rename — fix the
    implementation, or update both this manifest and the CHANGELOG
    in the same commit.
    """
    module = importlib.import_module(module_name)
    value: Any = getattr(module, attr, None)
    assert value is not None, (
        f"{module_name}.{attr} returned None — accidental removal? "
        f"If intentional, update this manifest + CHANGELOG together."
    )


def test_manifest_count_unchanged() -> None:
    """Snapshot the manifest size so silent drift surfaces.

    Bumping the count is fine in either direction — the test
    documents the intentional change in the diff. Lowering without
    a major-version bump is an audit signal.
    """
    # Update this number deliberately when adding/removing public names.
    expected = 75
    actual = len(CORE_PUBLIC_API)
    assert actual == expected, (
        f"CORE_PUBLIC_API has {actual} entries, expected {expected}. "
        f"If intentional, bump this number AND update the CHANGELOG."
    )
