"""Dry-run migration of one legacy project into the environment layout (ADR-0092 I07).

The tool works only on a snapshot it is given, and it writes only under a target directory it creates. It never opens
the live legacy runtime or the web database, and it never changes the source files.

  dry-run   copy the project's workspace and its thread rows out of the snapshot into the target, then record counts and
            hashes in report.json
  verify    recompute the same counts and hashes from the source and the target, and compare them
  rollback  delete the target directory, and only when it carries the marker written by dry-run

Layout expected under --snapshot:
  state/checkpoints.sqlite, state/instance_mailbox.sqlite   (with their -wal and -shm files, if present)
  workspace/<slug>/...
The thread ids come from a JSON list exported read-only from the web database (EngagementThread.threadId).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
from pathlib import Path

MARKER = ".migration-dryrun"
# Tables keyed by thread_id. Their rows for the project's threads are migrated; every other row stays behind.
THREAD_TABLES = {
    "checkpoints.sqlite": ["checkpoints", "writes"],
    "instance_mailbox.sqlite": ["instances", "messages", "grants"],
}
# Global stores that are not keyed by thread. They are reported, never copied, until a per-project split is decided.
GLOBAL_FILES = ["store.pckl", "store.vectors.pckl", ".langgraph_ops.pckl", ".langgraph_retry_counter.pckl"]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def manifest(root: Path) -> dict[str, dict[str, object]]:
    files: dict[str, dict[str, object]] = {}
    if not root.exists():
        return files
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        files[path.relative_to(root).as_posix()] = {"size": path.stat().st_size, "sha256": sha256_file(path)}
    return files


def load_threads(path: Path) -> list[str]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not all(isinstance(item, str) and item for item in raw):
        raise SystemExit("threads file must be a JSON list of thread id strings")
    return sorted(set(raw))


def copy_thread_rows(source: Path, target: Path, threads: list[str]) -> dict[str, int]:
    """Copy the schema and the rows of the given threads. Returns the row count per table in the target."""
    target.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
    dst = sqlite3.connect(target)
    counts: dict[str, int] = {}
    try:
        placeholders = ",".join("?" for _ in threads)
        for sql in [row[0] for row in src.execute("select sql from sqlite_master where sql is not null and type in ('table', 'index') order by type desc")]:
            dst.execute(sql)
        for table in THREAD_TABLES[source.name]:
            columns = [row[1] for row in src.execute(f'pragma table_info("{table}")')]
            if "thread_id" not in columns:
                raise SystemExit(f"{table} has no thread_id column; refusing to copy it")
            rows = src.execute(f'select * from "{table}" where thread_id in ({placeholders})', threads).fetchall()
            dst.executemany(f'insert into "{table}" ({",".join(chr(34) + c + chr(34) for c in columns)}) values ({",".join("?" for _ in columns)})', rows)
            counts[table] = len(rows)
        dst.commit()
    finally:
        src.close()
        dst.close()
    return counts


def source_counts(source: Path, threads: list[str]) -> dict[str, int]:
    src = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
    try:
        placeholders = ",".join("?" for _ in threads)
        return {table: src.execute(f'select count(*) from "{table}" where thread_id in ({placeholders})', threads).fetchone()[0] for table in THREAD_TABLES[source.name]}
    finally:
        src.close()


def target_counts(target: Path) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    for name, tables in THREAD_TABLES.items():
        path = target / "state" / name
        if not path.exists():
            continue
        dst = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
        try:
            result[name] = {table: dst.execute(f'select count(*) from "{table}"').fetchone()[0] for table in tables}
        finally:
            dst.close()
    return result


def dry_run(snapshot: Path, slug: str, threads: list[str], target: Path) -> dict[str, object]:
    if target.resolve() == snapshot.resolve() or snapshot.resolve() in target.resolve().parents:
        raise SystemExit("target must not be the snapshot or inside it")
    if target.exists() and any(target.iterdir()):
        raise SystemExit(f"target {target} is not empty; choose a new directory")
    target.mkdir(parents=True, exist_ok=True)
    (target / MARKER).write_text(json.dumps({"slug": slug, "snapshot": snapshot.as_posix()}), encoding="utf-8")

    workspace_source = snapshot / "workspace" / slug
    if not workspace_source.is_dir():
        raise SystemExit(f"no workspace for {slug} in the snapshot")
    shutil.copytree(workspace_source, target / "workspace" / slug)

    copied: dict[str, dict[str, int]] = {}
    for name in THREAD_TABLES:
        source = snapshot / "state" / name
        if source.exists():
            copied[name] = copy_thread_rows(source, target / "state" / name, threads)

    skipped = [{"file": name, "bytes": (snapshot / "state" / name).stat().st_size} for name in GLOBAL_FILES if (snapshot / "state" / name).exists()]
    report = {
        "slug": slug,
        "threads": threads,
        "workspace": {"source": manifest(workspace_source), "target": manifest(target / "workspace" / slug)},
        "rows": {"source": {name: source_counts(snapshot / "state" / name, threads) for name in THREAD_TABLES if (snapshot / "state" / name).exists()}, "target": copied},
        "not_migrated_global_stores": skipped,
        "warnings": ["The snapshot was copied while the legacy runtime was running. It is not a quiesced snapshot; cutover needs the source stopped."],
    }
    report["verified"] = verify(snapshot, slug, threads, target, report)["verified"]
    (target / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


def verify(snapshot: Path, slug: str, threads: list[str], target: Path, report: dict[str, object] | None = None) -> dict[str, object]:
    source_manifest = manifest(snapshot / "workspace" / slug)
    target_manifest = manifest(target / "workspace" / slug)
    workspace_ok = source_manifest == target_manifest and len(source_manifest) > 0
    source_rows = {name: source_counts(snapshot / "state" / name, threads) for name in THREAD_TABLES if (snapshot / "state" / name).exists()}
    target_rows = target_counts(target)
    rows_ok = source_rows == target_rows
    result = {"verified": workspace_ok and rows_ok, "workspace_files": len(source_manifest), "workspace_match": workspace_ok, "rows_match": rows_ok, "rows_source": source_rows, "rows_target": target_rows}
    if report is None:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    return result


def rollback(target: Path) -> None:
    if not (target / MARKER).exists():
        raise SystemExit("refusing to delete: the target has no dry-run marker")
    shutil.rmtree(target)
    print(f"removed {target}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("dry-run")
    run.add_argument("--snapshot", type=Path, required=True)
    run.add_argument("--slug", required=True)
    run.add_argument("--threads", type=Path, required=True)
    run.add_argument("--target", type=Path, required=True)
    check = sub.add_parser("verify")
    check.add_argument("--snapshot", type=Path, required=True)
    check.add_argument("--slug", required=True)
    check.add_argument("--threads", type=Path, required=True)
    check.add_argument("--target", type=Path, required=True)
    undo = sub.add_parser("rollback")
    undo.add_argument("--target", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "dry-run":
        report = dry_run(args.snapshot, args.slug, load_threads(args.threads), args.target)
        print(json.dumps({k: report[k] for k in ("slug", "verified", "rows", "not_migrated_global_stores")}, indent=2, ensure_ascii=False))
        return 0 if report["verified"] else 1
    if args.command == "verify":
        result = verify(args.snapshot, args.slug, load_threads(args.threads), args.target)
        return 0 if result["verified"] else 1
    rollback(args.target)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
