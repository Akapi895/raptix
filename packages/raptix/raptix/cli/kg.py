"""``raptix-cli kg`` — engagement-scoped attack-graph maintenance.

Subcommands:

* ``reset``  detach-delete every node in ONE engagement's graph slice.

Operator-invoked only; nothing in the runtime resets a graph
automatically (an engagement's graph is user data). Scope safety comes
from ``KGStore`` itself: every method, including the delete, filters on
the engagement label, so a reset of ``lab-a`` cannot touch ``lab-b``.
"""

from __future__ import annotations

import argparse
import json
import sys

from raptix.knowledge.graph.store import KGStore, KGStoreConfigError


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="raptix-cli kg",
        description="Engagement-scoped attack-graph maintenance.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    reset = sub.add_parser(
        "reset",
        help="Delete every node in one engagement's graph slice.",
        description=(
            "Detach-delete every node whose engagement label matches "
            "--engagement. Other engagements are untouched. Refuses to "
            "run without --yes."
        ),
    )
    reset.add_argument("--engagement", required=True, help="Engagement label to wipe.")
    reset.add_argument(
        "--yes",
        action="store_true",
        help="Confirm the deletion. Required; no prompt is shown.",
    )
    args = p.parse_args(argv)

    if args.cmd != "reset":  # pragma: no cover — argparse enforces choices
        p.print_usage(sys.stderr)
        return 2

    if not args.yes:
        print(
            f"refusing to reset KG for {args.engagement!r} without --yes "
            "(this permanently deletes the engagement's graph slice)",
            file=sys.stderr,
        )
        return 2

    try:
        store = KGStore.from_env()
    except KGStoreConfigError as exc:
        print(f"KG connection not configured: {exc}", file=sys.stderr)
        return 2

    try:
        deleted = store.delete_engagement(engagement=args.engagement)
    except ValueError as exc:
        print(f"invalid engagement: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # connection / driver errors
        print(f"KG reset failed: {exc}", file=sys.stderr)
        return 1
    finally:
        store.close()

    print(json.dumps({"engagement": args.engagement, "deleted": deleted}))
    return 0
