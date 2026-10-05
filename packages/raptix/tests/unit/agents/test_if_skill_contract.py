"""Prompt references must resolve within each agent's skill sources."""

from pathlib import Path

from raptix.agents.middleware_slots import skills_sources_for

_ROOT = Path(__file__).resolve().parents[3] / "raptix"
_DEFS = _ROOT / "skills" / "defs"
_PROMPTS = _ROOT / "agents" / "prompts" / "standard"


def test_router_and_final_report_resolve_for_orchestrator() -> None:
    sources = skills_sources_for("raptix")
    assert "/skills/standard/exploit/" in sources
    assert "/skills/standard/raptix/" in sources
    prompt = (_PROMPTS / "raptix.md").read_text(encoding="utf-8")
    assert "/skills/standard/raptix/final-report/SKILL.md" in prompt
    for source in sources:
        assert (_DEFS / source.removeprefix("/skills/")).is_dir()


def test_worker_sources_map_to_real_skill_directories() -> None:
    for role, folder in (("postexploit", "post-exploit"), ("cloud_hunter", "cloud")):
        assert f"/skills/standard/{folder}/" in skills_sources_for(role)
        assert (_DEFS / "standard" / folder).is_dir()
    assert "/skills/standard/blue_cell/" not in skills_sources_for("blue_cell")
    assert (_DEFS / "shared" / "defense-evasion" / "SKILL.md").is_file()


def test_exploit_worker_reports_dispatches_instead_of_calling_opplan() -> None:
    prompt = (_PROMPTS / "exploit.md").read_text(encoding="utf-8")
    assert "add_objective(...)" not in prompt
    assert "Update OPPLAN status" not in prompt
    assert "exploit/EXIT_REPORT.md" in prompt
