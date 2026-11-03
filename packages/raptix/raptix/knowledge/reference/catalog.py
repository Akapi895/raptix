"""Read-only source catalog and explicit background publication of reference data."""

from __future__ import annotations

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from raptix.knowledge.graph.migration_runner import apply_migrations
from raptix.knowledge.graph.query import INVENTORY_TIMEOUT_SECONDS, bounded_read
from raptix.knowledge.graph.store import KGStore
from raptix.knowledge.reference.history import knowledge_home
from raptix.knowledge.reference.loader import ingest_corpus, read_corpus


class CatalogConflict(ValueError):
    """Another process is discovering or publishing the corpus."""


def _lock_file() -> Any:
    handle = (knowledge_home() / "index.lock").open("a+b")
    try:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except OSError as exc:
        handle.close()
        raise CatalogConflict("A source scan or index operation is already running") from exc


class ReferenceCatalog:
    def __init__(self) -> None:
        self._mutex = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="knowledge-index")
        self._records: dict[str, dict[str, Any]] | None = None
        self._report: dict[str, Any] = {}
        self._job: dict[str, Any] = {"state": "idle", "processed": 0, "errors": []}
        self._graph: dict[str, dict[str, Any]] = {}
        self._graph_checked = 0.0
        self._graph_error = ""

    @property
    def root(self) -> Path:
        return Path(os.environ.get("RAPTIX_KNOWLEDGE_CORPUS_DIR", "data/knowledge")).resolve()

    def graph_inventory(self, *, refresh: bool = False) -> tuple[dict[str, dict[str, Any]], str]:
        with self._mutex:
            if not refresh and time.monotonic() - self._graph_checked < 5:
                return dict(self._graph), self._graph_error
        store = None
        try:
            store = KGStore.from_env()
            # A cold page cache or a concurrent index write can push this full
            # inventory scan past the interactive statement ceiling, which the
            # driver surfaces as a transient error. Retry once before reporting
            # the graph unavailable.
            for attempt in range(2):
                try:
                    rows = bounded_read(
                        store,
                        "MATCH (n:KrgReference) WHERE n.deprecated_at IS NULL RETURN n.id AS id, n.source AS source, n.name AS name, n.record_type AS type, n.description AS description, n.source_file_hash AS hash, n.ingested_at AS indexed_at, n.source_path AS path ORDER BY n.id LIMIT 100000",
                        {},
                        timeout=INVENTORY_TIMEOUT_SECONDS,
                    )
                    break
                except Exception:  # noqa: BLE001 — retry a transient read failure once
                    if attempt:
                        raise
            graph, error = {row["id"]: row for row in rows}, ""
        except Exception as exc:  # noqa: BLE001 — expose availability, never DB secrets
            graph, error = (
                dict(self._graph),
                f"Reference graph unavailable ({type(exc).__name__}); check Neo4j configuration and connectivity.",
            )
        finally:
            if store is not None:
                store.close()
        with self._mutex:
            self._graph, self._graph_error, self._graph_checked = graph, error, time.monotonic()
        return dict(graph), error

    def start(self, operation: str, *, allow_partial: bool = False) -> dict[str, Any]:
        with self._mutex:
            if self._job["state"] in {"scanning", "indexing"}:
                raise CatalogConflict("A source scan or index operation is already running")
            lock = _lock_file()
            self._job = {
                "state": "scanning" if operation == "scan" else "indexing",
                "processed": 0,
                "errors": [],
                "started_at": datetime.now(UTC).isoformat(),
            }
            try:
                self._persist_job()
                self._executor.submit(self._run, operation, allow_partial, lock)
            except Exception:  # noqa: BLE001 — release the lease if scheduling or persistence fails
                self._job["state"] = "failed"
                lock.close()
                raise
            return dict(self._job)

    def _persist_job(self) -> None:
        report_path = knowledge_home() / "index-status.json"
        temporary = report_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self._job), encoding="utf-8")
        temporary.replace(report_path)

    def _restore_job(self) -> dict[str, Any]:
        path = knowledge_home() / "index-status.json"
        try:
            saved = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else dict(self._job)
        except (ValueError, OSError):
            return dict(self._job)
        if saved.get("state") in {"scanning", "indexing"}:
            try:
                lease = _lock_file()
            except CatalogConflict:
                return saved
            try:
                self._job = {**saved, "state": "failed", "error": "The previous operation was interrupted. Some batches may have committed. Scan and retry; indexing is idempotent."}
                self._persist_job()
                return dict(self._job)
            finally:
                lease.close()
        if saved.get("state") == "failed":
            self._job = saved
        return saved

    def _run(self, operation: str, allow_partial: bool, lock: Any) -> None:
        store = None
        try:
            records, report = read_corpus(self.root)
            with self._mutex:
                self._records = {record["id"]: record for record in records}
                self._report = report
            if operation == "index":
                if report["errors"] and not allow_partial:
                    raise ValueError(
                        "Source validation failed. Review scan errors; no index writes were made."
                    )
                store = KGStore.from_env()
                apply_migrations(store)
                # Missing documents are preserved. Existing loader semantics retire only
                # obsolete relationships of the successfully validated present documents.
                result = ingest_corpus(
                    store, records, report, allow_partial=allow_partial, progress=self._progress, retire_missing=False
                )
                self.graph_inventory(refresh=True)
                if self._graph_error:
                    raise ValueError(self._graph_error)
                self._report = result
            with self._mutex:
                self._job.update(
                    state="partial" if report["errors"] else "completed",
                    processed=len(records),
                    errors=report["errors"],
                    completed_at=datetime.now(UTC).isoformat(),
                )
        except Exception as exc:  # noqa: BLE001 — persist explicit job failure after partial writes
            with self._mutex:
                self._job.update(
                    state="failed",
                    error=str(exc)
                    if isinstance(exc, ValueError)
                    else f"Operation failed ({type(exc).__name__}); check runtime logs and retry.",
                    errors=self._report.get("errors", []),
                )
        finally:
            if store is not None:
                store.close()
            try:
                with self._mutex:
                    self._persist_job()
            finally:
                lock.close()

    def _progress(self, processed: int, total: int) -> None:
        with self._mutex:
            self._job.update(processed=processed, total=total)

    def status(self) -> dict[str, Any]:
        graph, error = self.graph_inventory()
        with self._mutex:
            restored = self._restore_job() if self._job["state"] == "idle" else dict(self._job)
            if self._records is None and self._job["state"] == "idle" and self.root.is_dir() and restored.get("state") not in {"scanning", "indexing"}:
                try:
                    self.start("scan")
                except CatalogConflict:
                    pass  # Another worker owns discovery; its persisted status is read below.
            job = dict(self._job) if self._job["state"] != "idle" else restored
            discovered = len(self._records or {})
            matched = sum(
                graph.get(identity, {}).get("hash") == record["_hash"]
                for identity, record in (self._records or {}).items()
            )
            sources = sorted(
                {record["source"] for record in (self._records or {}).values()}
                | {row["source"] for row in graph.values() if row.get("source")}
            )
            categories = sorted(
                {record["type"] for record in (self._records or {}).values()}
                | {row["type"] for row in graph.values() if row.get("type")}
            )
        return {
            "directory": str(self.root),
            "directory_available": self.root.is_dir(),
            "discovered_items": discovered,
            "indexed_items": len(graph),
            "total_items": discovered or len(graph),
            "current_items": matched,
            "graph_available": not error,
            "graph_error": error,
            "initialized": bool(graph),
            "sources": sources,
            "categories": categories,
            "corpus_sha256": self._report.get("corpus_sha256"),
            "job": job,
            "is_rebuilding": job["state"] in {"scanning", "indexing"},
            "is_complete": not error and bool(graph) and (not discovered or matched == discovered) and not self._report.get("errors"),
            "last_error": job.get("error", ""),
            "last_indexed_at": max(
                (str(row.get("indexed_at") or "") for row in graph.values()), default=""
            ),
        }

    def library(
        self,
        *,
        search: str = "",
        source: str = "",
        category: str = "",
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        status = self.status()
        graph, _ = self.graph_inventory()
        with self._mutex:
            records = dict(self._records or {})
        identities = sorted(set(records) | set(graph))
        items = []
        for identity in identities:
            record, indexed = records.get(identity), graph.get(identity)
            row = record or indexed or {}
            row_source = row.get("source", "")
            kind = row.get("type", "")
            if source and source not in {"reference", row_source}:
                continue
            if category and category not in {row_source, kind}:
                continue
            if (
                search.casefold()
                not in f"{identity} {row.get('name', '')} {row.get('description', '')}".casefold()
            ):
                continue
            current = bool(indexed) and (not record or record["_hash"] == indexed.get("hash"))
            items.append(
                {
                    "id": "ref::" + identity,
                    "reference_id": identity,
                    "title": row.get("name", identity),
                    "category": kind,
                    "source": row_source,
                    "type": kind,
                    "content": str(row.get("description") or "")[:300],
                    "filePath": row.get("_path") or row.get("path"),
                    "index_status": "unknown" if not status["graph_available"] else "indexed"
                    if current
                    else "changed"
                    if indexed
                    else "discovered",
                    "indexed_at": indexed.get("indexed_at") if indexed else None,
                    "updatedAt": indexed.get("indexed_at") if indexed else None,
                    "read_only": True,
                }
            )
        if search:
            needle = search.casefold()
            items.sort(key=lambda item: (0 if item["title"].casefold() == needle else 1 if needle in item["title"].casefold() else 2, item["id"]))
        return {
            "items": items[offset : offset + limit],
            "total": len(items),
            "document_page": True,
            "status": status,
        }

    def detail(self, identity: str) -> dict[str, Any]:
        identity = identity.removeprefix("ref::")
        with self._mutex:
            record = (self._records or {}).get(identity)
        if record:
            source_path = self.root / record["_path"]
            path = source_path.resolve()
            if (
                not path.is_relative_to(self.root)
                or source_path.is_symlink()
                or path.stat().st_size > 1_000_000
            ):
                raise ValueError("Source path or document size is not allowed")
            content = path.read_bytes().decode("utf-8")
            return {
                "id": "ref::" + identity,
                "title": record["name"],
                "category": record["source"],
                "type": record["type"],
                "filePath": record["_path"],
                "content": content,
                "format": "yaml",
                "read_only": True,
            }
        store = KGStore.from_env()
        try:
            rows = bounded_read(
                store,
                "MATCH (n:KrgReference {id: $id}) RETURN properties(n) AS node LIMIT 1",
                {"id": identity},
            )
        finally:
            store.close()
        if not rows:
            raise KeyError(identity)
        node = rows[0]["node"]
        return {
            "id": "ref::" + identity,
            "title": node["name"],
            "category": node["source"],
            "content": yaml.safe_dump(
                json.loads(node.get("details_json") or "{}"), allow_unicode=True
            ),
            "format": "yaml",
            "filePath": node.get("source_path"),
            "indexed_snapshot": True,
            "read_only": True,
        }


catalog = ReferenceCatalog()
