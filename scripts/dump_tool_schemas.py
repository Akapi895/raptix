"""Dump a tool's rendered description + args schema exactly as the LLM sees it.

Usage (from repo root, inside the venv):
  python scripts/dump_tool_schemas.py raptix.execution.tools.research.tools RESEARCH_TOOLS --tool cve_lookup
  python scripts/dump_tool_schemas.py raptix.execution.tools.research.tools RESEARCH_TOOLS --summary
"""

import argparse
import json


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("module", help="dotted path to the module exposing a *_TOOLS list")
    ap.add_argument("listname", help="name of the tools list, e.g. RESEARCH_TOOLS")
    ap.add_argument("--tool", default=None, help="dump only this tool name")
    ap.add_argument(
        "--summary", action="store_true", help="per-tool char estimate only (schema-size view)"
    )
    a = ap.parse_args()

    mod = __import__(a.module, fromlist=[a.listname])
    tools = getattr(mod, a.listname)
    total = 0
    for t in tools:
        name = getattr(t, "name", "?")
        desc = str(getattr(t, "description", "") or "")
        schema = getattr(t, "args_schema", None)
        try:
            js = schema.model_json_schema() if schema is not None else {}
        except Exception:  # noqa: BLE001 — review helper, never fatal
            js = {}
        blob = name + desc + json.dumps(js)
        total += len(blob)
        if a.summary:
            print(f"{len(blob):>6}  {name}")
            continue
        if a.tool and name != a.tool:
            continue
        print("=" * 70)
        print("NAME:", name)
        print("DESCRIPTION:")
        print(desc)
        print("ARGS SCHEMA:")
        print(json.dumps(js, indent=1))
    if a.summary:
        print(f"TOTAL {len(tools)} tools, ~{total} chars")


if __name__ == "__main__":
    main()
