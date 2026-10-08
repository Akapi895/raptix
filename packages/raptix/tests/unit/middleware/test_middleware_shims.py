"""Tripwire: engagement.py and opplan.py under middleware/ must be shims.

ADR-0041 requires middleware to hold cross-cutting concerns only.
Engagement lifecycle and OPPLAN objective tracking moved to
orchestration/mission/ in W17–W18. These shims must stay thin
sys.modules redirects, not full implementations.
"""

from __future__ import annotations

from pathlib import Path

MIDDLEWARE_DIR = Path(__file__).resolve().parents[3] / "raptix" / "middleware"

SHIM_FILES = ["engagement.py", "opplan.py"]
MAX_SHIM_LINES = 20


def test_engagement_and_opplan_are_shims() -> None:
    for name in SHIM_FILES:
        path = MIDDLEWARE_DIR / name
        assert path.exists(), f"middleware/{name} missing"
        content = path.read_text(encoding="utf-8")
        lines = content.strip().splitlines()
        assert len(lines) <= MAX_SHIM_LINES, (
            f"middleware/{name} has {len(lines)} lines (max {MAX_SHIM_LINES}); "
            f"it should be a shim, not a full implementation"
        )
        assert "sys.modules" in content, f"middleware/{name} must use sys.modules redirect pattern"


def test_canonical_files_exist_in_orchestration_mission() -> None:
    mission_dir = Path(__file__).resolve().parents[3] / "raptix" / "orchestration" / "mission"
    for name in SHIM_FILES:
        canonical = mission_dir / name
        assert canonical.exists(), (
            f"orchestration/mission/{name} missing — canonical location required by ADR-0040"
        )
        content = canonical.read_text(encoding="utf-8")
        assert len(content.strip().splitlines()) > MAX_SHIM_LINES, (
            f"orchestration/mission/{name} looks like a shim, not the canonical implementation"
        )
