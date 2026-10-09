"""Export a sanitized, explicitly non-replayable copy of a runtime record."""

import argparse
from pathlib import Path

from raptix.runtime.recording import export_sanitized


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    count = export_sanitized(args.source, args.destination)
    print(f"Exported {count} sanitized entries to {args.destination}; replay disabled.")


if __name__ == "__main__":
    main()
