"""Run an explicit reference-corpus validation or ingestion command."""

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from raptix.knowledge.graph.migration_runner import apply_migrations
from raptix.knowledge.graph.store import KGStore
from raptix.knowledge.reference.loader import ingest_corpus, read_corpus


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--corpus-dir",
        type=Path,
        default=Path(os.environ.get("RAPTIX_KNOWLEDGE_CORPUS_DIR", "data/knowledge")),
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-partial", action="store_true")
    parser.add_argument("--manifest-output", type=Path)
    args = parser.parse_args()
    records, report = read_corpus(args.corpus_dir)
    write_failed = False
    if not args.dry_run and (not report["errors"] or args.allow_partial):
        store = None
        try:
            store = KGStore.from_env()
            apply_migrations(store)
            report = ingest_corpus(store, records, report, allow_partial=args.allow_partial)
        except Exception as exc:  # noqa: BLE001 — CLI writes a failure report, never reports partial writes as success
            write_failed = True
            report["partial"] = True
            report["errors"].append(
                {
                    "path": "graph",
                    "error": f"graph import failed ({type(exc).__name__}); rerun after recovery; no retirement attempted until all batches succeeded",
                }
            )
        finally:
            if store is not None:
                store.close()
    if args.manifest_output:
        args.manifest_output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    (args.corpus_dir / f"ingestion-report-{timestamp}.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    sys.stdout.write(json.dumps(report, indent=2) + "\n")
    return 1 if write_failed or (report["errors"] and not args.allow_partial) else 0


if __name__ == "__main__":
    raise SystemExit(main())
