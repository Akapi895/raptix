"""Repository-owned benchmark locations, independent of the caller's CWD."""

from datetime import datetime, timezone
from pathlib import Path

BENCHMARKS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BENCHMARKS_DIR.parent
RUNS_DIR = BENCHMARKS_DIR / "results" / "runs"
EXTERNAL_DIR = BENCHMARKS_DIR / "external"


def new_run_dir(suite: str) -> Path:
    """Choose a unique local output directory without creating it."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    return RUNS_DIR / suite / f"run-{timestamp}"
