"""W8 optional metadata surfaced on ``SkillRecord``."""

from raptix.execution.tools.plumbing.skills_registry import build_registry_from_package

_LEGACY = (
    "---\nname: legacy-skill\ndescription: skill without the W8 metadata block.\n---\n# body\n"
)

_ANNOTATED = (
    "---\n"
    "name: credential-reuse\n"
    "description: reuse recovered credentials.\n"
    "capabilities:\n"
    "  - credential_access\n"
    "ukc_phases:\n"
    "  - network_propagation\n"
    "requires:\n"
    "  - credential\n"
    "produces:\n"
    "  - session\n"
    "  - evidence\n"
    "---\n"
    "# body\n"
)


def _records(tmp_path, *texts: str):
    for index, text in enumerate(texts):
        skill_dir = tmp_path / f"standard/role-{index}"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(text, encoding="utf-8")
    return build_registry_from_package(tmp_path)


def test_legacy_skill_record_defaults_to_empty_metadata(tmp_path) -> None:
    (record,) = _records(tmp_path, _LEGACY)
    assert record.capabilities == ()
    assert record.ukc_phases == ()
    assert record.requires == ()
    assert record.produces == ()
    assert record.name == "legacy-skill"


def test_annotated_skill_record_carries_w8_metadata(tmp_path) -> None:
    (record,) = _records(tmp_path, _ANNOTATED)
    assert record.capabilities == ("credential_access",)
    assert record.ukc_phases == ("network_propagation",)
    assert record.requires == ("credential",)
    assert record.produces == ("session", "evidence")
