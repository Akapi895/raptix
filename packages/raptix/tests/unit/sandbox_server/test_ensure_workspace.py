"""Tests for the daemon's ``POST /workspace/ensure`` endpoint.

The endpoint materializes an engagement workspace dir inside the sandbox
container. Filesystem side effects are stubbed (CI has no /workspace);
the tests pin the contract that matters: normalization, engagement
fencing from the daemon's own env, and idempotence semantics.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from tests.unit.sandbox_server.test_app import _client, _make_backend


@pytest.fixture
def fs_stub(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, bool]]:
    """Stub the endpoint's filesystem effects; records mkdir calls."""
    made: list[tuple[str, bool]] = []
    existing: set[str] = set()
    monkeypatch.setattr("os.path.isdir", lambda p: p in existing, raising=True)

    def _fake_makedirs(path: str, exist_ok: bool = False) -> None:
        made.append((path, exist_ok))
        existing.add(path)

    monkeypatch.setattr("os.makedirs", _fake_makedirs, raising=True)
    return made


def test_ensure_creates_missing_workspace_dir(fs_stub) -> None:
    backend = _make_backend()
    with _client(backend) as client:
        resp = client.post("/workspace/ensure", json={"path": "/workspace/lab-01"})
    assert resp.status_code == 200
    assert resp.json() == {"path": "/workspace/lab-01", "created": True}
    assert fs_stub == [("/workspace/lab-01", True)]


def test_ensure_is_idempotent_when_dir_exists(fs_stub) -> None:
    backend = _make_backend()
    with _client(backend) as client:
        first = client.post("/workspace/ensure", json={"path": "/workspace/lab-01"})
        second = client.post("/workspace/ensure", json={"path": "/workspace/lab-01"})
    assert first.json()["created"] is True
    assert second.json() == {"path": "/workspace/lab-01", "created": False}


def test_ensure_normalizes_traversal_to_root_then_fences() -> None:
    backend = _make_backend()
    with (
        _client(backend, token="t") as client,
        patch.dict("os.environ", {"RAPTIX_ENGAGEMENT": "lab-01"}),
    ):
        resp = client.post(
            "/workspace/ensure",
            json={"path": "/workspace/../../etc"},
            headers={"Authorization": "Bearer t"},
        )
    assert resp.status_code == 403
    assert "/workspace/lab-01" in resp.json()["detail"]


def test_ensure_fences_other_engagement_when_slug_set() -> None:
    backend = _make_backend()
    with (
        _client(backend, token="t") as client,
        patch.dict("os.environ", {"RAPTIX_ENGAGEMENT": "lab-01"}),
    ):
        resp = client.post(
            "/workspace/ensure",
            json={"path": "/workspace/lab-02"},
            headers={"Authorization": "Bearer t"},
        )
    assert resp.status_code == 403
    assert "outside engagement 'lab-01'" in resp.json()["detail"]


def test_ensure_fences_shared_root_when_slug_set() -> None:
    backend = _make_backend()
    with (
        _client(backend, token="t") as client,
        patch.dict("os.environ", {"RAPTIX_ENGAGEMENT": "lab-01"}),
    ):
        resp = client.post(
            "/workspace/ensure",
            json={"path": "/workspace"},
            headers={"Authorization": "Bearer t"},
        )
    assert resp.status_code == 403


def test_ensure_allows_subpaths_of_the_engagement_workspace(fs_stub) -> None:
    backend = _make_backend()
    with (
        _client(backend, token="t") as client,
        patch.dict("os.environ", {"RAPTIX_ENGAGEMENT": "lab-01"}),
    ):
        resp = client.post(
            "/workspace/ensure",
            json={"path": "/workspace/lab-01/output"},
            headers={"Authorization": "Bearer t"},
        )
    assert resp.status_code == 200
    assert resp.json() == {"path": "/workspace/lab-01/output", "created": True}


def test_ensure_without_slug_serves_any_valid_workspace(fs_stub) -> None:
    backend = _make_backend()
    with _client(backend) as client:
        resp = client.post("/workspace/ensure", json={"path": "/workspace/anything"})
    assert resp.status_code == 200
    assert resp.json()["created"] is True


def test_ensure_requires_bearer_token_when_configured() -> None:
    backend = _make_backend()
    with _client(backend, token="s3cret") as client:
        resp = client.post("/workspace/ensure", json={"path": "/workspace/lab-01"})
    assert resp.status_code == 401


def test_ensure_rejects_invalid_slug_env() -> None:
    backend = MagicMock()
    with (
        _client(backend, token="t") as client,
        patch.dict("os.environ", {"RAPTIX_ENGAGEMENT": "../escape"}),
    ):
        resp = client.post(
            "/workspace/ensure",
            json={"path": "/workspace/lab-01"},
            headers={"Authorization": "Bearer t"},
        )
    assert resp.status_code == 500
    assert "not a valid engagement slug" in resp.json()["detail"]
