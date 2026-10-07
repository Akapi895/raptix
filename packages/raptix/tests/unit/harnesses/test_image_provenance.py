"""Tests for the lab harness's image-provenance enforcement (plan D6).

``_verify_image_provenance`` compares the deployed langgraph + sandbox
containers' org.opencontainers.image.revision label against HEAD and
refuses to run on a mismatch / missing label unless --allow-dirty is
passed. ``_docker`` + ``subprocess.run`` are stubbed; only the decision
logic is under test.
"""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest


def _load_harness():
    """Load tests/local/harnesses/lab_run.py by path.

    The repo-root ``tests/`` tree is not an importable package in the
    pytest pythonpath; the harness is a script. Loading by file path
    keeps the harness the single source of the decision logic.
    """
    repo_root = Path(__file__).resolve().parents[5]
    harness = repo_root / "tests" / "local" / "harnesses" / "lab_run.py"
    spec = importlib.util.spec_from_file_location("lab_run_harness", harness)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


lab_run = _load_harness()
_verify_image_provenance = lab_run._verify_image_provenance

HEAD = "a" * 40
OTHER = "b" * 40


def _args(allow_dirty: bool = False) -> argparse.Namespace:
    return argparse.Namespace(allow_dirty=allow_dirty)


def _proc(rc: int, out: str, err: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess([], rc, out, err)


def _patch_docker(mapping: dict[str, tuple[int, str, str]]):
    def fake_docker(args, *, timeout: int = 120):
        joined = " ".join(args)
        target = next((c for c in mapping if c in joined), None)
        if target is None:
            return _proc(1, "", f"unexpected docker args: {args}")
        rc, out, err = mapping[target]
        return _proc(rc, out, err)

    return patch.object(lab_run, "_docker", side_effect=fake_docker)


def test_matching_images_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: _proc(0, HEAD + "\n"))
    mapping = {
        "raptix-langgraph": (0, HEAD + "\n", ""),
        "raptix-sandbox": (0, HEAD + "\n", ""),
    }
    with _patch_docker(mapping):
        result = _verify_image_provenance(_args())
    assert result["verdict"] == "ok"
    assert result["langgraph"] == HEAD
    assert result["sandbox"] == HEAD
    assert result["expected_head"] == HEAD


def test_mismatch_refuses_by_default() -> None:
    mapping = {
        "raptix-langgraph": (0, OTHER + "\n", ""),
        "raptix-sandbox": (0, HEAD + "\n", ""),
    }
    with _patch_docker(mapping), pytest.raises(SystemExit, match="image at"):
        _verify_image_provenance(_args())


def test_missing_label_refuses() -> None:
    mapping = {
        "raptix-langgraph": (0, "\n", ""),  # label empty
        "raptix-sandbox": (0, HEAD + "\n", ""),
    }
    with (
        _patch_docker(mapping),
        pytest.raises(SystemExit, match="no org.opencontainers.image.revision"),
    ):
        _verify_image_provenance(_args())


def test_allow_dirty_downgrades_to_warning() -> None:
    mapping = {
        "raptix-langgraph": (0, OTHER + "\n", ""),
        "raptix-sandbox": (0, OTHER + "\n", ""),
    }
    with _patch_docker(mapping):
        result = _verify_image_provenance(_args(allow_dirty=True))
    assert result["verdict"] == "allow-dirty"
    assert result["langgraph"] == OTHER


def test_unlabeled_images_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # git unavailable -> expected_head unknown; missing labels still refuse
    # (an unlabeled image is unverifiable regardless of the expected head).
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: _proc(128, "", "not a repo"))
    mapping = {
        "raptix-langgraph": (0, "\n", ""),
        "raptix-sandbox": (0, "\n", ""),
    }
    with (
        _patch_docker(mapping),
        pytest.raises(SystemExit, match="no org.opencontainers.image.revision"),
    ):
        _verify_image_provenance(_args())


def test_unknown_container_refuses() -> None:
    mapping = {
        "raptix-langgraph": (1, "", "Error: No such object"),
        "raptix-sandbox": (0, HEAD + "\n", ""),
    }
    with _patch_docker(mapping), pytest.raises(SystemExit, match="container not found"):
        _verify_image_provenance(_args())


def test_unknown_checkout_refuses_even_when_images_are_labeled(monkeypatch) -> None:
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: _proc(128, "", "not a repo"))
    mapping = {"raptix-langgraph": (0, HEAD, ""), "raptix-sandbox": (0, HEAD, "")}
    with _patch_docker(mapping), pytest.raises(SystemExit, match="checkout HEAD"):
        _verify_image_provenance(_args())
