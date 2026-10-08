import glob
import subprocess
import zipfile
from pathlib import Path

import pytest


@pytest.mark.slow
def test_raptix_wheel_ships_runtime_without_corpus(tmp_path):
    # Build the wheels with the projects' backend (hatchling) via `uv build`
    # and assert the runtime wheel no longer bundles the skill corpus
    # (moved to the raptix-skills distribution in W9).
    packages_dir = Path(__file__).resolve().parents[3]
    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(tmp_path)],
        cwd=packages_dir / "raptix",
        check=True,
    )
    whl = sorted(glob.glob(str(tmp_path / "*.whl")))[-1]
    names = zipfile.ZipFile(whl).namelist()

    assert not any(n.startswith("raptix/skills/defs/") for n in names), (
        "corpus moved to raptix-skills and must not ride along in the raptix wheel"
    )


@pytest.mark.slow
def test_skills_wheel_bundles_corpus_but_excludes_benchmark(tmp_path):
    # Build the wheel with the project's backend (hatchling) via `uv build`
    # and assert the published artifact carries the standard/shared/plugins
    # skill trees as package data while excluding the benchmark eval-harness
    # skills. Marked slow: it shells out to a real build.
    packages_dir = Path(__file__).resolve().parents[3]
    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(tmp_path)],
        cwd=packages_dir / "raptix-skills",
        check=True,
    )
    whl = sorted(glob.glob(str(tmp_path / "*.whl")))[-1]
    names = zipfile.ZipFile(whl).namelist()

    assert any(n.startswith("raptix_skills/defs/standard/") for n in names), (
        "standard skills missing from wheel"
    )
    assert any(n.startswith("raptix_skills/defs/shared/") for n in names), (
        "shared skills missing from wheel"
    )
    assert any(n.startswith("raptix_skills/defs/plugins/") for n in names), (
        "plugins skills missing from wheel"
    )
    assert not any(n.startswith("raptix_skills/defs/benchmark/") for n in names), (
        "benchmark skills must be excluded from the wheel"
    )
