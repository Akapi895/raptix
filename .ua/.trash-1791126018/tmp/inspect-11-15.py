#!/usr/bin/env python3
import json, pathlib
PR = pathlib.Path("D:/.VTNet/redteam/raptix")
UA = PR / ".ua"
for idx in [11,12,13,14,15]:
    ext = json.load(open(UA/"tmp"/("ua-file-extract-results-%d.json"%idx), encoding="utf-8"))
    print("BATCH %d: analyzed=%d skipped=%s unreadable=%s outcomes=%s" % (idx, ext["filesAnalyzed"], ext["filesSkipped"], ext.get("filesUnreadable"), ext.get("analysisOutcomes")))
    for r in ext["results"][:4]:
        fns = [(f["name"], f["startLine"], f["endLine"]) for f in r.get("functions",[])]
        cls = [(c["name"], c["startLine"], c["endLine"], c.get("methods",[])) for c in r.get("classes",[])]
        exps = [e["name"] for e in r.get("exports",[])]
        print("  %s lines=%d/%d fns=%s cls=%s exps=%s calls=%d" % (r["path"], r["totalLines"], r["nonEmptyLines"], str(fns)[:220], str(cls)[:220], str(exps)[:220], len(r.get("callGraph",[]))))
    print()
