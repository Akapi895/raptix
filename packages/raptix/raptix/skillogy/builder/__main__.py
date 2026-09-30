"""``python -m raptix.skillogy.builder`` entrypoint."""

from __future__ import annotations

import sys

from raptix.skillogy.builder.cli import main

if __name__ == "__main__":
    sys.exit(int(main()))
