import os

from raptix.execution.backends import SKILLS_LOCAL_PATH


def test_skills_local_path_resolves_into_the_package():
    # Skills ship as package data under raptix/skills/defs/, so the resolved
    # path must end in .../raptix/skills/defs and actually exist on disk.
    assert SKILLS_LOCAL_PATH.endswith(os.path.join("raptix", "skills", "defs"))
    assert os.path.isdir(SKILLS_LOCAL_PATH)


def test_standard_and_shared_bundles_are_present():
    assert os.path.isdir(os.path.join(SKILLS_LOCAL_PATH, "standard"))
    assert os.path.isdir(os.path.join(SKILLS_LOCAL_PATH, "shared"))
