"""Explicit publication preserves existing documents and safely handles partial sources."""

import time
from pathlib import Path
from uuid import uuid4

import pytest
import yaml

from raptix.knowledge.graph.query import bounded_read
from raptix.knowledge.graph.store import KGStore
from raptix.knowledge.reference.catalog import ReferenceCatalog


def _wait(manager: ReferenceCatalog) -> dict:
    deadline = time.monotonic() + 60
    while manager._job["state"] in {"scanning", "indexing"} and time.monotonic() < deadline:
        time.sleep(0.05)
    assert manager._job["state"] not in {"scanning", "indexing"}
    return dict(manager._job)


def test_partial_publication_and_changed_relationships_preserve_other_indexed_documents(
    kgstore: KGStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "sources"
    root.mkdir()
    monkeypatch.setenv("RAPTIX_KNOWLEDGE_CORPUS_DIR", str(root))
    suffix = uuid4().hex
    first, second = f"attack:management-a-{suffix}", f"attack:management-b-{suffix}"
    record = {"id": first, "source": "attack", "type": "technique", "name": "Controlled reference A", "relationships": [{"target_id": second, "type": "child_of"}]}
    (root / "a.yaml").write_text(yaml.safe_dump(record), encoding="utf-8")
    (root / "b.yaml").write_text(yaml.safe_dump({"id": second, "source": "attack", "type": "technique", "name": "Controlled reference B"}), encoding="utf-8")
    (root / "invalid.yaml").write_text("name: invalid\n", encoding="utf-8")
    baseline = bounded_read(kgstore, "MATCH (n:KrgReference) WHERE n.deprecated_at IS NULL RETURN count(n) AS count", {})[0]["count"]
    manager = ReferenceCatalog()
    try:
        manager.start("index")
        assert _wait(manager)["state"] == "failed"
        assert bounded_read(kgstore, "MATCH (n:KrgReference {id: $id}) RETURN count(n) AS count", {"id": first})[0]["count"] == 0
        manager.start("index", allow_partial=True)
        assert _wait(manager)["state"] == "partial"
        assert manager.status()["is_complete"] is False
        assert bounded_read(kgstore, "MATCH (n:KrgReference) WHERE n.deprecated_at IS NULL RETURN count(n) AS count", {})[0]["count"] == baseline + 2
        (root / "invalid.yaml").unlink()
        (root / "b.yaml").unlink()
        record["relationships"] = []
        (root / "a.yaml").write_text(yaml.safe_dump(record), encoding="utf-8")
        manager.start("index")
        assert _wait(manager)["state"] == "completed"
        assert bounded_read(kgstore, "MATCH (n:KrgReference {id: $id}) WHERE n.deprecated_at IS NULL RETURN count(n) AS count", {"id": second})[0]["count"] == 1
        edges = bounded_read(kgstore, "MATCH (:KrgReference {id: $id})-[r:CHILD_OF]->() RETURN r.deprecated_at AS deprecated", {"id": first})
        assert edges and edges[0]["deprecated"]
        assert bounded_read(kgstore, "MATCH (n:KrgReference) WHERE n.deprecated_at IS NULL RETURN count(n) AS count", {})[0]["count"] == baseline + 2
    finally:
        manager._executor.shutdown(wait=True)
        with kgstore._driver.session(database=kgstore._database) as session:
            session.run("MATCH (n:KrgReference) WHERE n.id IN $ids DETACH DELETE n", ids=[first, second]).consume()
