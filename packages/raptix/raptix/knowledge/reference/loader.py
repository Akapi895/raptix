"""Validate the local corpus and publish bounded, idempotent reference batches."""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

from raptix.knowledge.graph.store import KGStore
from raptix.knowledge.reference.schema import RELATIONSHIPS, TYPE_LABELS

_VERSION_FIELDS = (
    "attack_version",
    "catalog_version",
    "collection_version",
    "format_version",
    "commit_sha",
    "commit",
)


def read_corpus(root: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not root.is_dir():
        raise ValueError(f"knowledge corpus directory does not exist: {root}")
    records: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    seen: set[str] = set()
    counts: Counter[str] = Counter()
    digests: dict[str, list[str]] = defaultdict(list)
    for path in sorted(root.rglob("*.yaml")):
        relative = path.relative_to(root).as_posix()
        try:
            if any(
                part.is_symlink()
                for part in (path, *path.parents)
                if part != root and part.is_relative_to(root)
            ):
                raise ValueError("source symlinks are not supported")
            if not path.resolve().is_relative_to(root.resolve()):
                raise ValueError("source escapes configured corpus directory")
            raw = path.read_bytes()
            record = yaml.load(raw, Loader=yaml.CSafeLoader)
            if not isinstance(record, dict) or any(
                not isinstance(record.get(key), str) or not record[key]
                for key in ("id", "source", "type", "name")
            ):
                raise ValueError("missing id/source/type/name")
            label = TYPE_LABELS.get((record["source"], record["type"]))
            if label is None or not record["id"].startswith(record["source"] + ":"):
                raise ValueError("unsupported type or invalid namespaced id")
            if record["id"] in seen:
                raise ValueError("duplicate namespaced id")
            relationships = record.get("relationships") or []
            if not isinstance(relationships, list) or any(
                not isinstance(rel, dict)
                or not isinstance(rel.get("target_id"), str)
                or not rel["target_id"]
                or not isinstance(rel.get("type"), str)
                or not rel["type"]
                for rel in relationships
            ):
                raise ValueError("invalid relationship target")
            if not isinstance(record.get("metadata", {}), dict):
                raise ValueError("metadata must be an object")
            seen.add(record["id"])
            checksum = hashlib.sha256(raw).hexdigest()
            record.update(_label=label, _path=relative, _hash=checksum)
            records.append(record)
            counts[record["source"]] += 1
            digests[record["source"]].append(f"{relative}\0{checksum}")
        except (OSError, ValueError, yaml.YAMLError) as exc:
            errors.append({"path": relative, "error": str(exc)})
    if not records:
        errors.append({"path": ".", "error": "corpus contains no valid records"})
    manifest = root / "MANIFEST.json"
    if manifest.is_file():
        try:
            expected = json.loads(manifest.read_text(encoding="utf-8"))
            if expected.get("total_files") != len(records) + len(errors):
                errors.append(
                    {
                        "path": "MANIFEST.json",
                        "error": "file count does not match manifest; refresh the corpus manifest before replacing a source",
                    }
                )
        except (OSError, ValueError) as exc:
            errors.append({"path": "MANIFEST.json", "error": str(exc)})
    sources = {
        source: {
            "files": counts[source],
            "sha256": hashlib.sha256("\n".join(hashes).encode()).hexdigest(),
        }
        for source, hashes in sorted(digests.items())
    }
    report: dict[str, Any] = {
        "schema_version": 1,
        "sources": sources,
        "files": len(records),
        "errors": errors,
        "corpus_sha256": hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
    }
    return records, report


def _properties(record: dict[str, Any]) -> dict[str, Any]:
    metadata = record.get("metadata") or {}
    version = {key: metadata[key] for key in _VERSION_FIELDS if key in metadata}
    details = {key: value for key, value in record.items() if not key.startswith("_")}
    return {
        "id": record["id"],
        "name": record["name"],
        "description": str(record.get("description") or ""),
        "source": record["source"],
        "record_type": record["type"],
        "source_version": json.dumps(version, sort_keys=True, default=str),
        "source_path": record["_path"],
        "source_file_hash": record["_hash"],
        "details_json": json.dumps(details, ensure_ascii=False, default=str),
        "deprecated_at": None,
    }


def _relationships(record: dict[str, Any]) -> list[dict[str, Any]]:
    edges = [
        {**rel, "source_id": rel.get("source_id") or record["id"]}
        for rel in record.get("relationships") or []
    ]
    for field, relation in (
        ("tactics", "IMPLEMENTS_TACTIC"),
        ("subtechniques", "HAS_SUBTECHNIQUE"),
        ("mitigation_links", "MITIGATED_BY"),
    ):
        for target in record.get(field) or []:
            target_id = target.get("id") if isinstance(target, dict) else target
            if isinstance(target_id, str):
                edges.append({"source_id": record["id"], "target_id": target_id, "type": relation})
    return edges


def ingest_corpus(
    store: KGStore,
    records: list[dict[str, Any]],
    report: dict[str, Any],
    *,
    allow_partial: bool = False,
    progress: Callable[[int, int], None] | None = None,
    retire_missing: bool = True,
) -> dict[str, Any]:
    if report["errors"] and not allow_partial:
        raise ValueError("corpus validation failed; no graph writes performed")
    # A partial import may add good records, but can never retire missing nodes/edges.
    complete = not report["errors"] and not allow_partial
    batch = str(uuid4())
    now = datetime.now(UTC).isoformat()
    by_label: dict[str, list[dict[str, Any]]] = defaultdict(list)
    identities = {record["id"]: record["_label"] for record in records}
    for record in records:
        by_label[record["_label"]].append(_properties(record))
    edge_groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    placeholders: dict[str, dict[str, str]] = {}
    unknown_types: Counter[str] = Counter()
    for record in records:
        for rel in _relationships(record):
            source_id, target_id = rel["source_id"], rel["target_id"]
            if source_id not in identities:
                continue
            original = rel["type"]
            relation = RELATIONSHIPS.get(
                original,
                original
                if original in {"IMPLEMENTS_TACTIC", "HAS_SUBTECHNIQUE", "MITIGATED_BY"}
                else "RELATED_TO",
            )
            if relation == "RELATED_TO":
                unknown_types[original] += 1
            target_label = identities.get(target_id, "KrgUnresolvedRef")
            if target_label == "KrgUnresolvedRef":
                placeholders[target_id] = {
                    "id": target_id,
                    "namespace": target_id.split(":", 1)[0],
                    "name": target_id,
                }
            props = {
                "source": record["source"],
                "original_type": original,
                "resolution_status": "external_unresolved"
                if target_label == "KrgUnresolvedRef"
                else "local_resolved",
                "source_file_hash": record["_hash"],
                "details_json": json.dumps(rel, default=str),
            }
            identity = hashlib.sha256(
                json.dumps(
                    [rel, identities[source_id], relation, target_label],
                    sort_keys=True,
                    default=str,
                ).encode()
            ).hexdigest()
            edge_groups[(identities[source_id], relation, target_label)].append(
                {
                    "source_id": source_id,
                    "target_id": target_id,
                    "identity": identity,
                    "props": props,
                }
            )

    # Whole-corpus transactions exceed Neo4j's transaction pool on the real corpus.
    # Each batch commits independently; retirement is reached only after all writes
    # succeed. An interrupted import is explicit and safe to rerun, never "rolled back"
    # by deleting nodes that may have existed before this invocation.
    report.update(batch_id=batch, ingested_at=now, created=0, merged=0, deprecated=0)

    def write(cypher: str, **params: Any) -> Any:
        with store._driver.session(database=store._database) as session:
            return session.execute_write(lambda tx: tx.run(cypher, **params).consume().counters)

    for label, rows in by_label.items():
        for offset in range(0, len(rows), 100):
            chunk = rows[offset : offset + 100]
            counters = write(
                f"UNWIND $rows AS row MERGE (n:{label} {{id: row.id}}) SET n:KrgReference, n += row, n.ingestion_batch_id = $batch, n.ingested_at = $now",
                rows=chunk,
                batch=batch,
                now=now,
            )
            report["created"] += counters.nodes_created
            report["merged"] += len(chunk) - counters.nodes_created
            if progress is not None:
                progress(report["created"] + report["merged"], len(records))
    if placeholders:
        write(
            "UNWIND $rows AS row MERGE (n:KrgUnresolvedRef {id: row.id, namespace: row.namespace}) SET n.name = row.name",
            rows=list(placeholders.values()),
        )
    for (src, relation, dst), rows in edge_groups.items():
        for offset in range(0, len(rows), 100):
            write(
                f"UNWIND $rows AS row MATCH (s:{src} {{id: row.source_id}}), (d:{dst} {{id: row.target_id}}) MERGE (s)-[r:{relation} {{identity: row.identity}}]->(d) SET r += row.props, r.ingestion_batch_id = $batch, r.ingested_at = $now, r.deprecated_at = null",
                rows=rows[offset : offset + 100],
                batch=batch,
                now=now,
            )
    if complete:
        for label in set(TYPE_LABELS.values()):
            if retire_missing:
                counters = write(
                    f"MATCH (n:{label}) WHERE n.source IN $sources AND NOT n.id IN $ids AND n.deprecated_at IS NULL SET n.deprecated_at = $now",
                    sources=list(report["sources"]),
                    ids=list(identities),
                    now=now,
                )
                report["deprecated"] += counters.properties_set
            write(
                f"MATCH (s:{label})-[r]->(d) WHERE r.source IN $sources AND ($retire_missing OR s.id IN $present) AND NOT r.identity IN $ids AND r.deprecated_at IS NULL SET r.deprecated_at = $now",
                sources=list(report["sources"]),
                ids=[edge["identity"] for group in edge_groups.values() for edge in group],
                present=list(identities),
                retire_missing=retire_missing,
                now=now,
            )
    return {
        **report,
        "unresolved": len(placeholders),
        "relationship_types_preserved_as_related": dict(unknown_types),
        "edges": sum(len(rows) for rows in edge_groups.values()),
        "partial": not complete,
    }
