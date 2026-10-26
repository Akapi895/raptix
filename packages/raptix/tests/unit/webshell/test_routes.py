from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from raptix.execution.backends.project_files import ProjectFileUnavailable
from raptix.execution.tools.webshell.gates import WebShellRefused
from raptix.interfaces.api.webshell_routes import router

REQUEST_ID = "0f8fad5b-d9cb-469f-a165-70867728950e"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _body(**overrides):
    body = {
        "sandbox_url": "http://sandbox:8080",
        "sandbox_token": "token",
        "request_id": REQUEST_ID,
        "profile": {
            "provider": "http-form-command",
            "target": "10.129.88.4",
            "endpoint": "http://10.129.88.4/dev/phpbash.php",
            "method": "POST",
            "content_type": "application/x-www-form-urlencoded",
            "command_parameter": "cmd",
            "probe_command": "id;hostname",
            "probe_pattern": "uid=33",
            "expected_user": "www-data",
        },
    }
    body.update(overrides)
    return body


def test_probe_success(monkeypatch):
    async def fake_probe(config, profile):
        assert config["configurable"]["sandbox_url"] == "http://sandbox:8080"
        return {"state": "reachable", "http_status": 200, "matched": True, "output": "uid=33"}

    monkeypatch.setattr("raptix.interfaces.api.webshell_routes.probe_webshell", fake_probe)
    response = _client().post("/_raptix/webshell/probe", json=_body())
    assert response.status_code == 200
    assert response.json()["state"] == "reachable"


def test_invalid_profile_is_400(monkeypatch):
    async def fake_probe(config, profile):
        raise AssertionError("must not run")

    monkeypatch.setattr("raptix.interfaces.api.webshell_routes.probe_webshell", fake_probe)
    body = _body()
    body["profile"]["endpoint"] = "http://10.129.88.5/dev/phpbash.php"
    response = _client().post("/_raptix/webshell/probe", json=body)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_profile"


def test_gate_refusal_is_403(monkeypatch):
    async def fake_execute(config, profile, command):
        raise WebShellRefused("NOT_IN_SCOPE", "target is out of scope")

    monkeypatch.setattr("raptix.interfaces.api.webshell_routes.execute_webshell", fake_execute)
    body = _body(command="whoami")
    response = _client().post("/_raptix/webshell/execute", json=body)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "NOT_IN_SCOPE"


def test_project_unavailable_is_503(monkeypatch):
    async def fake_probe(config, profile):
        raise ProjectFileUnavailable("no sandbox")

    monkeypatch.setattr("raptix.interfaces.api.webshell_routes.probe_webshell", fake_probe)
    response = _client().post("/_raptix/webshell/probe", json=_body())
    assert response.status_code == 503


def test_invalid_request_id_is_422():
    response = _client().post("/_raptix/webshell/probe", json=_body(request_id="short"))
    assert response.status_code == 422
