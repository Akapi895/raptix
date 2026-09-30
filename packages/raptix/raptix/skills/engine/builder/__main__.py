"""``python -m raptix.skills.engine.builder`` entrypoint."""

from __future__ import annotations

import sys

from raptix.skills.engine.builder.cli import main

if __name__ == "__main__":
    sys.exit(int(main()))
