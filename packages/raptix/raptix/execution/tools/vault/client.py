"""HTTP client for apps/api's internal vault routes.

apps/api/Postgres owns Vault secrets (same as Project/WebShellConnection --
see this repo's CLAUDE.md on business-record ownership); the Python runtime
reaches it over HTTP, the reverse direction of the existing runtime-api-token
lane (``interfaces/api/auth.py``). ``RAPTIX_WEB_API_URL`` points at apps/api
(default ``http://api:8080``) -- distinct from ``RAPTIX_API_URL``, which some
containers set to mean "this stack's own langgraph API". The bearer token is
read from the file named by ``RAPTIX_WEB_API_INTERNAL_TOKEN_FILE``, mirroring
``auth.py``'s module-level token cache.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx

URL_ENV = "RAPTIX_WEB_API_URL"
TOKEN_FILE_ENV = "RAPTIX_WEB_API_INTERNAL_TOKEN_FILE"
DEFAULT_URL = "http://api:8080"
_MIN_TOKEN_BYTES = 32

_token_cache: str | None = None


class VaultUnavailable(RuntimeError):
    """Raised when the vault's HTTP lane is not configured or not reachable."""


def _token() -> str:
    global _token_cache
    if _token_cache is not None:
        return _token_cache
    raw_path = os.environ.get(TOKEN_FILE_ENV, "").strip()
    if not raw_path:
        raise VaultUnavailable(f"{TOKEN_FILE_ENV} is not configured")
    try:
        token = Path(raw_path).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise VaultUnavailable(f"{TOKEN_FILE_ENV} could not be read: {exc}") from exc
    if len(token) < _MIN_TOKEN_BYTES:
        raise VaultUnavailable(f"{TOKEN_FILE_ENV} token must be at least {_MIN_TOKEN_BYTES} bytes")
    _token_cache = token
    return token


def _base_url() -> str:
    return os.environ.get(URL_ENV, DEFAULT_URL).rstrip("/")


def _request(
    method: str, path: str, *, json: dict[str, Any] | None = None, timeout: float = 10.0
) -> dict[str, Any]:
    token = _token()
    try:
        with httpx.Client(base_url=_base_url(), timeout=timeout) as client:
            resp = client.request(
                method, path, json=json, headers={"authorization": f"Bearer {token}"}
            )
    except httpx.HTTPError as exc:
        raise VaultUnavailable(f"vault request failed: {exc}") from exc
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("error", resp.text)
        except ValueError:
            detail = resp.text
        raise VaultUnavailable(f"vault {method} {path} -> {resp.status_code}: {detail}")
    try:
        return resp.json()
    except ValueError as exc:
        raise VaultUnavailable(f"vault {method} {path} returned a non-JSON body") from exc


def store_secret(
    workspace_slug: str,
    name: str,
    value: str,
    *,
    description: str = "",
    kind: str = "credential",
    actor: str = "",
) -> dict[str, Any]:
    return _request(
        "POST",
        "/api/internal/vault/secrets",
        json={
            "workspace_slug": workspace_slug,
            "name": name,
            "plaintext": value,
            "description": description,
            "kind": kind,
            "actor": actor,
        },
    )


def retrieve_secret(workspace_slug: str, name: str) -> str:
    result = _request("GET", f"/api/internal/vault/secrets/{workspace_slug}/{name}")
    plaintext = result.get("plaintext")
    if not isinstance(plaintext, str):
        raise VaultUnavailable("vault retrieve returned no plaintext")
    return plaintext


def list_secrets(workspace_slug: str) -> list[dict[str, Any]]:
    result = _request("GET", f"/api/internal/vault/secrets/{workspace_slug}")
    secrets = result.get("secrets")
    return secrets if isinstance(secrets, list) else []
