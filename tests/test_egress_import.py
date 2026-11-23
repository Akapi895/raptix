"""The egress policy compiler must import with agent boot disabled."""

import os
import subprocess
import sys


def test_egress_compiler_imports_without_booting_agents() -> None:
    result = subprocess.run(
        [sys.executable, "-B", "-c", "from raptix.middleware.egress import compile_egress_policy"],
        env={**os.environ, "RAPTIX_SKIP_BOOT": "1"},
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
