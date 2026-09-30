"""``python -m raptix.skills.audit`` entrypoint."""

from __future__ import annotations

import sys

from raptix.skills.audit.cli import main

if __name__ == "__main__":
    sys.exit(int(main()))
