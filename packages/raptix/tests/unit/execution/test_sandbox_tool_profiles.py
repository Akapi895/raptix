"""Drift-guard tests for the Wave T8 sandbox executor profiles.

Parses ``infra/containers/sandbox.Dockerfile`` and the root
``docker-compose.yml`` as text (no Docker daemon, no build) and pins the
T8 contract: three opt-in profiles with exactly the planned kali package
sets, build-time version manifests for execution provenance, compose
build-arg passthrough defaulting to off, and a catalog-side cross-check
that no ``ImplementationSpec.profile`` names a profile the image cannot
provide.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

import pytest
import yaml

from raptix.execution.capabilities.catalog import build_catalog

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[5]
DOCKERFILE_PATH: Final[Path] = REPO_ROOT / "infra" / "containers" / "sandbox.Dockerfile"
COMPOSE_PATH: Final[Path] = REPO_ROOT / "docker-compose.yml"

MANIFEST_DIR: Final[str] = "/opt/raptix/tool-versions"

# The T8 plan table: profile → apt packages (kali-rolling).
T8_PROFILES: Final[dict[str, frozenset[str]]] = {
    "sandbox-web": frozenset({"httpx-toolkit", "katana", "ffuf", "nuclei", "testssl.sh"}),
    "sandbox-ad": frozenset({"netexec", "certipy-ad", "evil-winrm"}),
    "sandbox-pivot": frozenset({"ligolo-ng"}),
}

T8_BUILD_ARGS: Final[dict[str, str]] = {
    "sandbox-web": "INSTALL_WEB_TOOLS",
    "sandbox-ad": "INSTALL_AD_TOOLS",
    "sandbox-pivot": "INSTALL_PIVOT_TOOLS",
}


def _logical_instructions(text: str) -> list[str]:
    """Join backslash continuations into one string per Dockerfile
    instruction, dropping comment lines (the parser strips those first,
    including inside continued instructions)."""
    instructions: list[str] = []
    buffer: list[str] = []
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.endswith("\\"):
            buffer.append(stripped[:-1].rstrip())
            continue
        buffer.append(stripped)
        instructions.append(" ".join(buffer))
        buffer.clear()
    return instructions


def _profile_run_instruction(instructions: list[str], arg_name: str) -> str:
    marker = f'if [ "${arg_name}" = "true" ]; then'
    matches = [
        instruction
        for instruction in instructions
        if instruction.startswith("RUN") and marker in instruction
    ]
    assert len(matches) == 1, f"expected exactly one RUN block gated on {arg_name}"
    return matches[0]


def _apt_install_packages(run_instruction: str) -> frozenset[str]:
    match = re.search(r"--no-install-suggests\s+(.+?)\s*&&", run_instruction)
    assert match is not None, "install list not found in RUN block"
    return frozenset(match.group(1).split())


def _arg_defaults(instructions: list[str]) -> dict[str, str]:
    defaults: dict[str, str] = {}
    for instruction in instructions:
        if instruction.startswith("ARG "):
            name, _, value = instruction[4:].partition("=")
            defaults[name.strip()] = value.strip()
    return defaults


@pytest.fixture()
def instructions() -> list[str]:
    return _logical_instructions(DOCKERFILE_PATH.read_text(encoding="utf-8"))


def test_t8_profile_args_default_to_off(instructions: list[str]) -> None:
    defaults = _arg_defaults(instructions)
    for arg_name in T8_BUILD_ARGS.values():
        assert defaults.get(arg_name) == "false", f"{arg_name} must be opt-in"
    # The reversing gate predates T8 and must keep its default.
    assert defaults.get("INSTALL_REVERSING") == "false"


@pytest.mark.parametrize(("profile", "packages"), sorted(T8_PROFILES.items()))
def test_t8_profiles_install_the_planned_package_sets(
    instructions: list[str],
    profile: str,
    packages: frozenset[str],
) -> None:
    run_instruction = _profile_run_instruction(instructions, T8_BUILD_ARGS[profile])
    assert _apt_install_packages(run_instruction) == packages, (
        f"{profile} package set drifted from the T8 plan table"
    )


@pytest.mark.parametrize("profile", sorted(T8_PROFILES))
def test_t8_profiles_write_a_version_manifest(
    instructions: list[str],
    profile: str,
) -> None:
    run_instruction = _profile_run_instruction(instructions, T8_BUILD_ARGS[profile])
    expected = f"{MANIFEST_DIR}/{profile}.tsv"
    assert f"> {expected}" in run_instruction, (
        f"{profile} must record installed tool versions for execution provenance"
    )


def test_nuclei_template_corpus_recorded_as_runtime_fetched(
    instructions: list[str],
) -> None:
    run_instruction = _profile_run_instruction(instructions, "INSTALL_WEB_TOOLS")
    assert "nuclei-templates" in run_instruction
    assert "runtime-fetched" in run_instruction


def test_compose_passes_t8_build_args_defaulting_off() -> None:
    compose = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))
    build_args = compose["services"]["sandbox"]["build"]["args"]
    for profile, arg_name in T8_BUILD_ARGS.items():
        assert build_args.get(arg_name) == "${" + arg_name + ":-false}", (
            f"{profile} compose passthrough must default to off"
        )
    # The reversing toolset stays sidecar-scoped (ghidra-mcp) by design.
    assert "INSTALL_REVERSING" not in build_args


def test_catalog_profiles_are_provided_by_the_image(instructions: list[str]) -> None:
    defaults = _arg_defaults(instructions)
    image_profiles = {"base", *T8_PROFILES}
    for manifest in build_catalog():
        for implementation in manifest.implementations:
            profile = implementation.profile
            assert profile is None or profile in image_profiles, (
                f"{manifest.id} declares profile {profile!r} the sandbox image cannot provide"
            )
    # Sanity: the T8 args exist so the guard stays meaningful if renamed.
    assert set(T8_BUILD_ARGS.values()) <= set(defaults)
