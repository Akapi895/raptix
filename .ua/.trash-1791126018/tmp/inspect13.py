#!/usr/bin/env python3
import json, pathlib, re
PR = pathlib.Path("D:/.VTNet/redteam/raptix")
UA = PR / ".ua"
for idx in [13]:
    ext = json.load(open(UA/"tmp"/("ua-file-extract-results-%d.json"%idx), encoding="utf-8"))
    for r in ext["results"]:
        if r["classes"]:
            print(r["path"])
            for c in r["classes"]:
                print("  CLASS", c["name"], c["startLine"], c["endLine"], c.get("methods"), c.get("properties"))
            print("  exports:", [e["name"] for e in r.get("exports",[])])
            print("  fns:", [(f["name"], f["startLine"], f["endLine"]) for f in r.get("functions",[])][:12])
            print()
