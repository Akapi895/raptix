"""W8 optional skill metadata rules (capabilities/ukc_phases/requires/produces)."""

import pytest

from raptix.skills.audit.rules import RuleId, validate_skill_file


def _skill(*extra_lines: str) -> str:
    base = [
        "---",
        "name: credential-reuse",
        "description: reuse a recovered credential against reachable services.",
        "metadata:",
        "  subdomain: recon",
        "  when_to_use: after credentials have been recovered",
    ]
    return "\n".join([*base, *extra_lines, "---", "", "# body", ""])


def violations_for(text: str) -> list[tuple[RuleId, str]]:
    return [(v.rule_id, v.detail) for v in validate_skill_file("/skills/x/SKILL.md", text)]


def test_legacy_skill_without_metadata_has_no_w8_violations() -> None:
    w8 = [
        v
        for v in violations_for(_skill())
        if v[0] in {RuleId.BAD_UKC_PHASE, RuleId.BAD_METADATA_LIST}
    ]
    assert w8 == []


def test_valid_w8_metadata_passes() -> None:
    text = _skill(
        "capabilities:",
        "  - credential_access",
        "  - lateral_movement",
        "ukc_phases:",
        "  - network_propagation",
        "requires:",
        "  - credential",
        "produces:",
        "  - session",
    )
    w8 = [
        v for v in violations_for(text) if v[0] in {RuleId.BAD_UKC_PHASE, RuleId.BAD_METADATA_LIST}
    ]
    assert w8 == []


def test_non_canonical_ukc_phase_is_flagged() -> None:
    text = _skill("ukc_phases:", "  - persistence")
    assert any(v[0] is RuleId.BAD_UKC_PHASE for v in violations_for(text))


def test_ukc_phases_must_be_a_list() -> None:
    text = _skill("ukc_phases: network_propagation")
    assert any(v[0] is RuleId.BAD_UKC_PHASE for v in violations_for(text))


def test_all_three_canonical_slugs_are_accepted() -> None:
    for slug in ("initial_foothold", "network_propagation", "action_on_objectives"):
        text = _skill("ukc_phases:", f"  - {slug}")
        assert not any(v[0] is RuleId.BAD_UKC_PHASE for v in violations_for(text))


@pytest.mark.parametrize("field", ["capabilities", "requires", "produces"])
def test_malformed_list_metadata_is_flagged(field: str) -> None:
    flat = _skill(f"{field}: credential_access")
    assert any(v[0] is RuleId.BAD_METADATA_LIST and field in v[1] for v in violations_for(flat))
    empty = _skill(f"{field}:", '  - ""')
    assert any(
        v[0] is RuleId.BAD_METADATA_LIST and "non-empty" in v[1] for v in violations_for(empty)
    )
    duplicate = _skill(f"{field}:", "  - credential", "  - credential")
    assert any(
        v[0] is RuleId.BAD_METADATA_LIST and "unique" in v[1] for v in violations_for(duplicate)
    )
