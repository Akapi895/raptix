"""Capture separate proxy/provider evidence; credentials remain in environment."""

import json
import sys

from benchmarks.context_eval.cache_probe import main


def capture() -> None:
    print(json.dumps(main(sys.argv[1:]), indent=2))


if __name__ == "__main__":
    capture()
