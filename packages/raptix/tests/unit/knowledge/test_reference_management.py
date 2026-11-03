"""Discovery, durable retrieval metadata and authenticated management failures."""

import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from raptix.knowledge.reference.catalog import CatalogConflict, ReferenceCatalog, _lock_file
from raptix.knowledge.reference.history import delete_retrieval, record_retrieval, retrieval_history


@pytest.fixture
def manager(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "corpus"
    root.mkdir()
    (root / "one.yaml").write_text(
        "id: attack:T1000\nsource: attack\ntype: technique\nname: Test technique\ndescription: Real source content\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("RAPTIX_KNOWLEDGE_CORPUS_DIR", str(root))
    monkeypatch.setenv("RAPTIX_KNOWLEDGE_STATE_DIR", str(tmp_path / "state"))
    for key in ("RAPTIX_NEO4J_URI", "RAPTIX_NEO4J_USER", "RAPTIX_NEO4J_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    value = ReferenceCatalog()
    yield value
    value._executor.shutdown(wait=True)


def wait_job(manager: ReferenceCatalog) -> dict:
    deadline = time.monotonic() + 10
    while manager._job["state"] in {"scanning", "indexing"} and time.monotonic() < deadline:
        time.sleep(0.02)
    assert manager._job["state"] not in {"scanning", "indexing"}
    return manager._job


def test_source_discovery_is_not_an_index_and_read_only_details_preserve_source(
    manager: ReferenceCatalog,
) -> None:
    original = (manager.root / "one.yaml").read_bytes()
    manager.start("scan")
    assert wait_job(manager)["state"] == "completed"
    page = manager.library(limit=1)
    assert page["total"] == 1
    assert page["items"][0]["index_status"] == "unknown"
    assert page["status"]["graph_available"] is False
    assert manager.detail("ref::attack:T1000")["content"].encode() == original
    assert (manager.root / "one.yaml").read_bytes() == original
    assert manager.library(search="not present")["total"] == 0
    assert manager.library(offset=1)["items"] == []


def test_invalid_sources_are_reported_and_block_publication(manager: ReferenceCatalog) -> None:
    (manager.root / "invalid.yaml").write_text("invalid: source\n", encoding="utf-8")
    manager.start("index")
    job = wait_job(manager)
    assert job["state"] == "failed"
    assert "no index writes" in job["error"]
    assert job["errors"][0]["path"] == "invalid.yaml"
    assert manager.library()["total"] == 1


def test_cross_process_lock_rejects_conflicting_jobs_and_releases(
    manager: ReferenceCatalog,
) -> None:
    lock = _lock_file()
    try:
        with pytest.raises(CatalogConflict):
            manager.start("index")
    finally:
        lock.close()
    manager.start("scan")
    assert wait_job(manager)["state"] == "completed"


def test_retrieval_events_are_durable_bounded_and_filterable(manager: ReferenceCatalog) -> None:
    record_retrieval(
        "search_by_name",
        {"q": "command"},
        {"nodes": [{"id": "attack:T1000"}]},
        {"configurable": {"thread_id": "thread-a", "run_id": "run-a"}},
    )
    record_retrieval(
        "search_by_name",
        {"q": "missing"},
        {"nodes": []},
        {"configurable": {"thread_id": "thread-b"}},
        status="error",
    )
    page = retrieval_history(thread_id="thread-a")
    assert page["total"] == 1
    assert page["logs"][0]["hits"] == 1
    assert page["logs"][0]["items"] == ["attack:T1000"]
    assert retrieval_history(search="missing")["logs"][0]["status"] == "error"
    assert delete_retrieval(page["logs"][0]["id"])
    assert retrieval_history(thread_id="thread-a")["total"] == 0


def test_interrupted_operation_is_reported_after_restart_and_can_be_retried(manager: ReferenceCatalog) -> None:
    import json

    from raptix.knowledge.reference.history import knowledge_home

    (knowledge_home() / "index-status.json").write_text(json.dumps({"state": "indexing", "processed": 100, "errors": []}), encoding="utf-8")
    status = manager.status()
    assert status["job"]["state"] == "failed"
    assert "interrupted" in status["last_error"]
    manager.start("scan")
    assert wait_job(manager)["state"] == "completed"


def test_failed_reference_query_records_failure_without_replacing_the_error(manager: ReferenceCatalog) -> None:
    from unittest.mock import MagicMock

    from raptix.knowledge.graph.query import GraphQuery
    from raptix.knowledge.reference.query import retrieve_reference

    store = MagicMock()
    store._driver.session.return_value.__enter__.return_value.execute_read.side_effect = RuntimeError("controlled graph outage")
    query = GraphQuery(graph="reference", query_type="search_by_name", params={"kind": "KrgReference", "q": "command"})
    with pytest.raises(RuntimeError, match="controlled graph outage"):
        retrieve_reference(store, query)
    event = retrieval_history()["logs"][0]
    assert event["status"] == "error" and event["hits"] == 0


def test_management_router_requires_service_auth_and_forbids_arbitrary_paths(
    manager: ReferenceCatalog, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from raptix.interfaces.api import auth, knowledge_routes

    token = "knowledge-management-test-token-0123456789"
    secret = tmp_path / "token"
    secret.write_text(token, encoding="utf-8")
    monkeypatch.setenv("RAPTIX_RUNTIME_API_TOKEN_FILE", str(secret))
    monkeypatch.setattr(auth, "_token_cache", None)
    monkeypatch.setattr(knowledge_routes, "catalog", manager)
    app = FastAPI()
    app.include_router(knowledge_routes.router)
    with TestClient(app) as client:
        assert client.post("/_raptix/knowledge/status", json={}).status_code == 401
        headers = {"authorization": f"Bearer {token}"}
        assert client.post("/_raptix/knowledge/status", json={}, headers=headers).status_code == 200
        assert (
            client.post(
                "/_raptix/knowledge/scan", json={"root": "/etc"}, headers=headers
            ).status_code
            == 422
        )
        assert client.post(
            "/_raptix/knowledge/detail", json={"id": "../../secrets"}, headers=headers
        ).status_code in {404, 503}
