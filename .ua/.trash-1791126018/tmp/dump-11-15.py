#!/usr/bin/env python3
import json, pathlib
PR = pathlib.Path("D:/.VTNet/redteam/raptix")
UA = PR / ".ua"
batches = json.load(open(UA/"intermediate"/"batches.json", encoding="utf-8"))
exts = {}
for idx in [11,12,13,14,15]:
    exts[idx] = {r["path"]: r for r in json.load(open(UA/"tmp"/("ua-file-extract-results-%d.json"%idx), encoding="utf-8"))["results"]}
lines = []
for idx in [11,12,13,14,15]:
    b = [x for x in batches["batches"] if x.get("batchIndex")==idx][0]
    lines.append("="*100)
    lines.append("BATCH %d" % idx)
    for f in b["files"]:
        p = f["path"]
        r = exts[idx].get(p, {})
        fns = [(x["name"], x["startLine"], x["endLine"]) for x in r.get("functions",[])]
        cls = [(x["name"], x["startLine"], x["endLine"]) for x in r.get("classes",[])]
        exps = [e["name"] for e in r.get("exports",[])]
        src = (PR/p).read_text(encoding="utf-8", errors="replace")
        head = "\n".join(src.splitlines()[:6]).replace("\n"," | ")[:300]
        lines.append("- %s (%d lines) fns=%s cls=%s exps=%s" % (p, f["sizeLines"], fns, cls, exps))
        lines.append("  head: %s" % head)
        lines.append("  imports: %s" % (b["batchImportData"].get(p, []),))
open(UA/"tmp"/"dump-11-15.txt","w",encoding="utf-8").write("\n".join(lines))
print("wrote dump lines=%d" % len(lines))
