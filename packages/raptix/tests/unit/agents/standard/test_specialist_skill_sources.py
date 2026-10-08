from __future__ import annotations

from pathlib import Path

import pytest
from raptix_active_directory.agent import DEFINITION as _ad_def
from raptix_contracts.agent import DEFINITION as _contracts_def
from raptix_ics.agent import DEFINITION as _ics_def
from raptix_iot.agent import DEFINITION as _iot_def
from raptix_mobile.agent import DEFINITION as _mobile_def
from raptix_phishing.agent import DEFINITION as _phisher_def
from raptix_wireless.agent import DEFINITION as _wireless_def

from raptix.execution.backends import SKILLS_LOCAL_PATH
from raptix.intelligence.agents.standard import (
    forensicator,
    osint_operator,
    supply_chain_operator,
)

_SKILLS_ROOT = Path(SKILLS_LOCAL_PATH)

# Every bash specialist that pins an explicit skill-source list whose
# primary directory name differs from its role. Plugin-owned specialists
# (W10) contribute their ``DomainAgentDefinition.skill_sources``; the
# WAVE-3 runtime specialists still declare ``_SKILL_SOURCES`` on their
# graph-host modules.
# Mapping: (skill sources, role, the /skills/standard/ dir its primary
# content lives in).
_EXPLICIT_SOURCE_AGENTS = [
    (_ad_def.skill_sources, _ad_def.role, "/skills/standard/ad/"),
    (_contracts_def.skill_sources, _contracts_def.role, "/skills/standard/contracts/"),
    (_mobile_def.skill_sources, _mobile_def.role, "/skills/standard/mobile/"),
    (_wireless_def.skill_sources, _wireless_def.role, "/skills/standard/wireless/"),
    (_phisher_def.skill_sources, _phisher_def.role, "/skills/standard/phisher/"),
    (osint_operator._SKILL_SOURCES, osint_operator._ROLE, "/skills/standard/osint/"),
    (_iot_def.skill_sources, _iot_def.role, "/skills/standard/iot/"),
    (_ics_def.skill_sources, _ics_def.role, "/skills/standard/ics/"),
    (forensicator._SKILL_SOURCES, forensicator._ROLE, "/skills/standard/dfir/"),
    (
        supply_chain_operator._SKILL_SOURCES,
        supply_chain_operator._ROLE,
        "/skills/standard/supply-chain/",
    ),
]

# Specialists whose role name does NOT match a /skills/standard/<role>/
# dir, so they MUST pin an explicit source list (otherwise the default
# ``skills_sources_for(role)`` would resolve to a non-existent directory —
# the exact phisher-class bug this guards against). ``phisher`` is excluded:
# its role name and skill dir intentionally coincide.
_ROLE_NE_DIR_AGENTS = [
    ("/skills/standard/ad/", "ad_operator"),
    ("/skills/standard/contracts/", "contract_auditor"),
    ("/skills/standard/mobile/", "mobile_operator"),
    ("/skills/standard/wireless/", "wireless_operator"),
    ("/skills/standard/osint/", "osint_operator"),
    ("/skills/standard/iot/", "iot_operator"),
    ("/skills/standard/ics/", "ics_operator"),
    ("/skills/standard/dfir/", "forensicator"),
    ("/skills/standard/supply-chain/", "supply_chain_operator"),
]


def _resolve(source: str) -> Path:
    assert source.startswith("/skills/")
    return _SKILLS_ROOT / source[len("/skills/") :].strip("/")


@pytest.mark.parametrize(("sources", "role", "expected_standard_dir"), _EXPLICIT_SOURCE_AGENTS)
def test_specialist_skill_source_dir_exists_and_non_empty(sources, role, expected_standard_dir):
    assert role
    assert expected_standard_dir in sources
    resolved = _resolve(expected_standard_dir)
    assert resolved.is_dir()
    # The dir must carry real skill content, not just exist — this is what
    # the phisher agent silently lacked (only an empty subdir) before wiring.
    assert any(resolved.rglob("SKILL.md"))


@pytest.mark.parametrize(("expected_standard_dir", "role"), _ROLE_NE_DIR_AGENTS)
def test_specialist_role_named_skill_dir_does_not_exist(role, expected_standard_dir):
    assert expected_standard_dir
    role_dir = _SKILLS_ROOT / "standard" / role
    assert not role_dir.exists()


@pytest.mark.parametrize(("sources", "role", "expected_standard_dir"), _EXPLICIT_SOURCE_AGENTS)
def test_specialist_skill_sources_all_resolve_on_disk(sources, role, expected_standard_dir):
    assert role and expected_standard_dir
    for source in sources:
        assert _resolve(source).is_dir()
