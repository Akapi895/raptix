"""Stability snapshot — every public ``decepticon-sdk`` name imports.

Spec §6.3 lists the SDK single-import surface that plugin authors
rely on. This test locks in the 23 stable symbols + the testing
fakes so a removed re-export fails CI.

See ``packages/raptix-core/tests/test_public_api_stability.py``
for the corresponding core-layer snapshot.
"""

from __future__ import annotations

import importlib
from typing import Any

import pytest

SDK_PUBLIC_API: tuple[tuple[str, str], ...] = (
    # Protocols (7)
    ("raptix_sdk", "BackendProtocol"),
    ("raptix_sdk", "MiddlewareProtocol"),
    ("raptix_sdk", "ToolProtocol"),
    ("raptix_sdk", "CallbackProtocol"),
    ("raptix_sdk", "LLMProtocol"),
    ("raptix_sdk", "SandboxProtocol"),
    ("raptix_sdk", "AgentProtocol"),
    # Slot enum + constants (3)
    ("raptix_sdk", "MiddlewareSlot"),
    ("raptix_sdk", "SAFETY_CRITICAL_SLOTS"),
    ("raptix_sdk", "SLOTS_PER_ROLE"),
    # Focused contributions (5)
    ("raptix_sdk", "ToolContribution"),
    ("raptix_sdk", "MiddlewareContribution"),
    ("raptix_sdk", "PromptContribution"),
    ("raptix_sdk", "SubAgentContribution"),
    ("raptix_sdk", "SafetyDeclaration"),
    # Plugin loader (3)
    ("raptix_sdk", "PluginBundle"),
    ("raptix_sdk", "SubAgentSpec"),
    ("raptix_sdk", "is_bundle_enabled"),
    # Registry (8)
    ("raptix_sdk", "PluginRegistry"),
    ("raptix_sdk", "PluginInfo"),
    ("raptix_sdk", "PluginConflictWarning"),
    ("raptix_sdk", "RoleRegistry"),
    ("raptix_sdk", "RoleSpec"),
    ("raptix_sdk", "RoleResolution"),
    ("raptix_sdk", "SafetyRegistry"),
    ("raptix_sdk", "SkillSourceRegistry"),
    # Testing fakes (3)
    ("raptix_sdk.testing", "FakeBackend"),
    ("raptix_sdk.testing", "FakeLLM"),
    ("raptix_sdk.testing", "FakeSandbox"),
    # Scaffold entry (CLI also wired via [project.scripts])
    ("raptix_sdk.scaffold", "app"),
)


@pytest.mark.parametrize(("module_name", "attr"), SDK_PUBLIC_API)
def test_sdk_public_name_importable(module_name: str, attr: str) -> None:
    module = importlib.import_module(module_name)
    value: Any = getattr(module, attr, None)
    assert value is not None, (
        f"{module_name}.{attr} returned None — accidental removal? "
        f"If intentional, update this manifest + CHANGELOG together."
    )


def test_sdk_manifest_count_unchanged() -> None:
    """Snapshot the manifest size."""
    expected = 30
    actual = len(SDK_PUBLIC_API)
    assert actual == expected, (
        f"SDK_PUBLIC_API has {actual} entries, expected {expected}. "
        f"If intentional, bump this number AND update the CHANGELOG."
    )
