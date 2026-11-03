"""Vault tools exercise the real HTTP code path end-to-end.

No Node process is started here -- a minimal stub server stands in for
apps/api's internal vault routes, implementing the exact wire contract
(POST /api/internal/vault/secrets, GET .../{slug}/{name}, bearer-token
check). This proves execution/tools/vault/client.py's request/response
handling against a real socket, not a monkeypatched function -- the
Node-side contract itself is covered separately by
apps/api/tests/integration/vault.live.ts.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from raptix.execution.tools.vault import client as vault_client
from raptix.execution.tools.vault.tools import vault_retrieve, vault_store

VALID_TOKEN = "live-stub-internal-token-32-bytes-or-more"


class _StubVaultHandler(BaseHTTPRequestHandler):
    secrets: dict[tuple[str, str], str] = {}

    def _authorized(self) -> bool:
        return self.headers.get("authorization") == f"Bearer {VALID_TOKEN}"

    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler's required name)
        if not self._authorized():
            self._send_json(401, {"error": "Invalid internal token"})
            return
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        workspace_slug, name, plaintext = body["workspace_slug"], body["name"], body["plaintext"]
        self.secrets[(workspace_slug, name)] = plaintext
        self._send_json(
            200, {"status": "stored", "name": name, "vault_ref": f"vault://{workspace_slug}-{name}"}
        )

    def do_GET(self) -> None:  # noqa: N802
        if not self._authorized():
            self._send_json(401, {"error": "Invalid internal token"})
            return
        parts = urlsplit(self.path).path.strip("/").split("/")
        # /api/internal/vault/secrets/<slug>/<name>
        workspace_slug, name = parts[-2], parts[-1]
        plaintext = self.secrets.get((workspace_slug, name))
        if plaintext is None:
            self._send_json(404, {"error": "Secret not found"})
            return
        self._send_json(200, {"plaintext": plaintext})

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass  # silence BaseHTTPRequestHandler's default stderr access log


@pytest.fixture
def stub_vault_server(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _StubVaultHandler.secrets = {}
    server = ThreadingHTTPServer(("127.0.0.1", 0), _StubVaultHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    token_file = tmp_path / "web-api-internal-token"
    token_file.write_text(VALID_TOKEN)
    monkeypatch.setenv("RAPTIX_WEB_API_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("RAPTIX_WEB_API_INTERNAL_TOKEN_FILE", str(token_file))
    monkeypatch.setattr(vault_client, "_token_cache", None)
    try:
        yield server
    finally:
        server.shutdown()
        thread.join(timeout=5)


def test_store_then_retrieve_round_trips_over_real_http(stub_vault_server) -> None:
    store_result = json.loads(
        vault_store.func(
            name="found-password",
            value="h4rvested!",
            description="",
            kind="credential",
            config=None,
            state={"engagement_name": "proj-live"},
        )
    )
    assert store_result == {
        "status": "stored",
        "name": "found-password",
        "vault_ref": "vault://proj-live-found-password",
    }

    retrieve_result = json.loads(
        vault_retrieve.func(
            name="found-password", config=None, state={"engagement_name": "proj-live"}
        )
    )
    assert retrieve_result == {"name": "found-password", "value": "h4rvested!"}


def test_wrong_token_is_refused(
    stub_vault_server, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bad_token_file = tmp_path / "wrong-token"
    bad_token_file.write_text("this-token-is-definitely-wrong-and-long-enough")
    monkeypatch.setenv("RAPTIX_WEB_API_INTERNAL_TOKEN_FILE", str(bad_token_file))
    monkeypatch.setattr(vault_client, "_token_cache", None)

    result = json.loads(
        vault_store.func(name="x", value="y", config=None, state={"engagement_name": "proj-live"})
    )
    assert "error" in result
    assert "401" in result["error"] or "Invalid internal token" in result["error"]


def test_missing_token_file_is_refused(stub_vault_server, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RAPTIX_WEB_API_INTERNAL_TOKEN_FILE", raising=False)
    monkeypatch.setattr(vault_client, "_token_cache", None)

    result = json.loads(
        vault_retrieve.func(name="x", config=None, state={"engagement_name": "proj-live"})
    )
    assert "error" in result
    assert "RAPTIX_WEB_API_INTERNAL_TOKEN_FILE" in result["error"]
