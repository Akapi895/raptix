"""``python -m raptix.skill_audit`` entrypoint."""

from __future__ import annotations

import sys

from raptix.skill_audit.cli import main

if __name__ == "__main__":
    sys.exit(int(main()))
