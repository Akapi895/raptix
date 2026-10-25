"""The runtime API token gate: only a caller that presents the web API's token is served (interfaces/api/auth.py)."""

import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from raptix.interfaces.api import auth as runtime_auth

TOKEN = "runtime-api-token-0123456789abcdef"


@pytest.fixture(autouse=True)
def _reset_token_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime_auth, "_token_cache", None)
    monkeypatch.delenv(runtime_auth.TOKEN_FILE_ENV, raising=False)


def _token_file(tmp_path: Path, content: str) -> None:
    path = tmp_path / "runtime-api-token"
    path.write_text(content, encoding="utf-8")
    os.environ[runtime_auth.TOKEN_FILE_ENV] = str(path)


def test_accepts_the_matching_bearer_token(tmp_path: Path) -> None:
    _token_file(tmp_path, TOKEN + "\n")
    assert runtime_auth._matches(f"Bearer {TOKEN}")


@pytest.mark.parametrize(
    "header",
    [None, "", "Bearer wrong-token-0123456789abcdef0123", f"Basic {TOKEN}", f"Bearer {TOKEN}x"],
)
def test_refuses_any_other_caller(tmp_path: Path, header: str | None) -> None:
    _token_file(tmp_path, TOKEN)
    assert not runtime_auth._matches(header)


def test_refuses_every_caller_when_the_token_is_not_configured() -> None:
    assert not runtime_auth._matches(f"Bearer {TOKEN}")


def test_refuses_every_caller_when_the_token_is_too_short(tmp_path: Path) -> None:
    _token_file(tmp_path, "short")
    assert not runtime_auth._matches("Bearer short")


def test_route_dependency_raises_401_for_a_wrong_token(tmp_path: Path) -> None:
    _token_file(tmp_path, TOKEN)
    with pytest.raises(HTTPException) as refused:
        runtime_auth.require_runtime_token("Bearer nope")
    assert refused.value.status_code == 401
    runtime_auth.require_runtime_token(f"Bearer {TOKEN}")


def test_plugin_routes_refuse_callers_without_the_token() -> None:
    from fastapi.testclient import TestClient

    from raptix.interfaces.api.plugins_api import app

    assert TestClient(app).get("/_decepticon/bundles").status_code == 401
