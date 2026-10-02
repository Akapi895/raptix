"""ADR-0030 (Step 3) — static contract checks for the IF layer.

The audit's P1-5 finding: the recon→exploit classification handoff is
governed by three artifacts (orchestrator prompt, worker prompts, skill
ACL in ``skills_sources_for``) that had drifted apart — the orchestrator
was told to load exploit router skills its ACL denied, one prompt cited
a ``/skills/standard/raptix/`` path that never existed, and worker
prompts instructed OPPLAN tool calls the workers have no tools for.

These tests pin the contract statically (no agent construction):

1. every fallback ``skills_sources_for(role)`` path resolves to a real
   directory under ``skills/defs/`` (no dead ACL entries),
2. the orchestrator's ACL includes the exploit router tree and the
   role↔directory divergences map correctly,
3. every concrete ``/skills/.../*.md`` path cited in a prompt exists on
   disk and sits inside that role's ACL,
4. worker prompts never instruct OPPLAN tool calls — the OPPLAN CRUD
   surface is orchestrator-only (``SLOTS_PER_ROLE``).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from raptix.agents.middleware_slots import skills_sources_for
from raptix.tools.opplan import OPPLAN_TOOL_NAMES

_REPO_ROOT = Path(__file__).resolve().parents[5]
_PROMPTS = _REPO_ROOT / "packages/raptix/raptix/agents/prompts/standard"
_SKILLS_DEFS = _REPO_ROOT / "packages/raptix/raptix/skills/defs"
_STANDARD_AGENTS = _REPO_ROOT / "packages/raptix/raptix/agents/standard"

# Matches concrete skill references only — ``<domain>``/``<X>`` style
# placeholders in prompts contain ``<``/``>`` and are skipped.
_SKILL_REF = re.compile(r"/skills/[\w./-]+?\.md")

# The orchestrator is the only standard role whose slot set includes
# MiddlewareSlot.OPPLAN (see ``SLOTS_PER_ROLE``), so it is the only
# prompt allowed to instruct OPPLAN CRUD calls.
_ORCHESTRATOR_PROMPT = "decepticon.md"

# Prompt stem → effective role for ACL checks. ``autohunt`` reuses the
# soundwave role (``autohunt.py`` sets ``_ROLE = "soundwave"``), so its
# ACL is soundwave's.
_ROLE_BY_PROMPT = {"autohunt": "soundwave"}


def _fallback_reliant_roles() -> list[str]:
    """Roles that rely on ``skills_sources_for`` for their skill ACL.

    Derived from the agent factories: any ``agents/standard/*.py`` that
    does not pass an explicit ``skill_sources=`` kwarg to
    ``build_middleware`` falls back to ``skills_sources_for(<_ROLE>)``.
    Derived (not hardcoded) so a new role with a dead ACL path cannot
    slip past the on-disk test below.
    """
    roles: set[str] = set()
    for src in sorted(_STANDARD_AGENTS.glob("*.py")):
        # ``_*.py`` are shared helpers, not factories; ``__init__.py``
        # only re-exports.
        if src.name.startswith("_") or src.name == "__init__.py":
            continue
        text = src.read_text(encoding="utf-8")
        if "skill_sources=" in text:
            continue
        match = re.search(r'^_ROLE\s*=\s*"([^"]+)"', text, re.MULTILINE)
        assert match is not None, (
            f"{src.name} declares no _ROLE yet relies on the skill-source fallback"
        )
        roles.add(match.group(1))
    return sorted(roles)


def _prompt_files() -> list[Path]:
    return sorted(_PROMPTS.glob("*.md"))


def _virtual_to_disk(virtual: str) -> Path:
    """/skills/standard/exploit/web/SKILL.md → defs/standard/exploit/web/SKILL.md."""
    prefix = "/skills/"
    assert virtual.startswith(prefix), f"not a /skills/ path: {virtual}"
    return _SKILLS_DEFS / virtual[len(prefix) :]


def _prompt_skill_refs(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    return sorted(set(_SKILL_REF.findall(text)))


# ── 1. No dead ACL entries ────────────────────────────────────────────


def test_fallback_skill_sources_resolve_on_disk() -> None:
    """Every ACL path emitted by the fallback must exist under defs/.

    This is the regression test for the P1-5 dead-path class:
    ``/skills/standard/postexploit/`` (real dir: ``post-exploit``),
    ``/skills/standard/cloud_hunter/`` (real dir: ``cloud``) and
    ``/skills/standard/blue_cell/`` (no tree at all) all used to be
    emitted and resolved to nothing.
    """
    for role in _fallback_reliant_roles():
        for source in skills_sources_for(role):
            on_disk = _virtual_to_disk(source)
            assert on_disk.is_dir(), (
                f"role {role!r}: skill source {source!r} resolves to "
                f"{on_disk}, which does not exist on disk"
            )


# ── 2. Role ↔ directory mapping + orchestrator ACL ───────────────────


def test_orchestrator_acl_includes_exploit_router_tree() -> None:
    """decepticon.md instructs loading exploit router skills — its ACL
    must contain the exploit tree (P1-5: router outside default ACL)."""
    sources = skills_sources_for("decepticon")
    assert "/skills/standard/exploit/" in sources


def test_postexploit_acl_maps_to_post_exploit_dir() -> None:
    sources = skills_sources_for("postexploit")
    assert "/skills/standard/post-exploit/" in sources
    assert "/skills/standard/postexploit/" not in sources


def test_cloud_hunter_acl_maps_to_cloud_dir() -> None:
    sources = skills_sources_for("cloud_hunter")
    assert "/skills/standard/cloud/" in sources
    assert "/skills/standard/cloud_hunter/" not in sources


def test_blue_cell_acl_has_no_dead_standard_path() -> None:
    sources = skills_sources_for("blue_cell")
    assert "/skills/standard/blue_cell/" not in sources
    assert "/skills/shared/" in sources


# ── 3. Prompt skill refs exist on disk and sit inside the ACL ────────


def test_concrete_prompt_skill_refs_exist_on_disk() -> None:
    for prompt in _prompt_files():
        for ref in _prompt_skill_refs(prompt):
            on_disk = _virtual_to_disk(ref)
            assert on_disk.is_file(), f"{prompt.name} cites {ref!r} but {on_disk} does not exist"


@pytest.mark.parametrize("prompt", _prompt_files(), ids=lambda p: p.name)
def test_concrete_prompt_skill_refs_within_role_acl(
    prompt: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    refs = _prompt_skill_refs(prompt)
    if not refs:
        pytest.skip(f"{prompt.name} cites no concrete skill paths")
    role = _ROLE_BY_PROMPT.get(prompt.stem, prompt.stem)
    # BENCHMARK_MODE widens every ACL with /skills/benchmark/ — decepticon.md
    # cites that path in its benchmark fast-path section, so evaluate the
    # ACL with the benchmark sources included.
    monkeypatch.setenv("BENCHMARK_MODE", "1")
    sources = skills_sources_for(role)
    for ref in refs:
        assert any(ref.startswith(source) for source in sources), (
            f"{prompt.name} (role {role!r}) cites {ref!r} which is outside its skill ACL {sources}"
        )


# ── 4. OPPLAN CRUD is orchestrator-only in the prompt contract ───────


def test_worker_prompts_do_not_instruct_opplan_calls() -> None:
    tool_alternation = "|".join(sorted(OPPLAN_TOOL_NAMES))
    opplan_call = re.compile(rf"\b(?:{tool_alternation})\s*\(")
    for prompt in _prompt_files():
        if prompt.name == _ORCHESTRATOR_PROMPT:
            continue
        text = prompt.read_text(encoding="utf-8")
        match = opplan_call.search(text)
        assert match is None, (
            f"{prompt.name} instructs an OPPLAN tool call "
            f"{match.group(0)!r} but the role has no OPPLAN middleware "
            f"(OPPLAN CRUD is orchestrator-only per SLOTS_PER_ROLE)"
        )
