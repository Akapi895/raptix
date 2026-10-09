#!/usr/bin/env python3
import json, os, re
UA = r"D:\.VTNet\redteam\raptix\.ua"
d = json.load(open(os.path.join(UA, "intermediate", "batch-9.json"), encoding="utf-8"))
batches = json.load(open(os.path.join(UA, "intermediate", "batches.json"), encoding="utf-8"))
b = [x for x in batches["batches"] if x["batchIndex"] == 9][0]
# 1. batchFiles verbatim
assert d["batchFiles"] == b["files"], "batchFiles not verbatim"
print("batchFiles verbatim OK:", len(d["batchFiles"]))
# 2. node checks
allowed_types = {"file","function","class","config","document","service","table","endpoint","pipeline","schema","resource"}
allowed_prefix = {"file:","function:","class:","config:","document:","service:","table:","endpoint:","pipeline:","schema:","resource:"}
bad = []
for n in d["nodes"]:
    for f in ("id","type","name","summary","tags","complexity"):
        if f not in n or not n[f]:
            bad.append((n.get("id"), f"missing {f}"))
    if n["type"] not in allowed_types:
        bad.append((n["id"], "bad type"))
    if not any(n["id"].startswith(p) for p in allowed_prefix):
        bad.append((n["id"], "bad prefix"))
    if n["type"] in ("file","config","document","service","pipeline","schema","resource") and "filePath" not in n:
        bad.append((n["id"], "missing filePath"))
    if n["type"] in ("function","class") and "lineRange" not in n:
        bad.append((n["id"], "missing lineRange"))
    if n["complexity"] not in ("simple","moderate","complex"):
        bad.append((n["id"], "bad complexity"))
print("node field errors:", len(bad), bad[:5])
# dup ids
ids = [n["id"] for n in d["nodes"]]
print("dup node ids:", len(ids)-len(set(ids)))
# 3. edge checks
allowed_e = {"contains","exports","imports","calls","inherits","implements","depends_on","tested_by","configures","documents","deploys","migrates","triggers","defines_schema","serves","provisions","routes","related"}
bad_e = [e for e in d["edges"] if e["type"] not in allowed_e or e["direction"]!="forward" or e["source"]==e["target"]]
print("bad edges:", len(bad_e))
# edge endpoint validation (Step E)
node_ids = set(ids)
import_map = b["batchImportData"]
neigh = b.get("neighborMap", {})
file_refs = set()
for v in import_map.values():
    file_refs.update("file:"+p for p in v)
for v in neigh.values():
    for e in v:
        file_refs.add("file:"+e["path"])
neigh_syms = set()
for v in neigh.values():
    for e in v:
        for s in e.get("symbols", []):
            neigh_syms.add((e["path"], s))
def edge_ok(e):
    s, t = e["source"], e["target"]
    def ok(x):
        if x in node_ids:
            return True
        if x.startswith("file:") and x in file_refs:
            return True
        m = re.match(r"^(function|class):(.+):([^:]+)$", x)
        if m:
            _, p, sym = m.groups()
            if (p, sym) in neigh_syms:
                return True
            # in-batch file but symbol not neighbor? allow if file in batchFiles and node exists? already checked
            return False
        return False
    return ok(s) and ok(t)
invalid = [e for e in d["edges"] if not edge_ok(e)]
print("edges failing Step E:", len(invalid))
for e in invalid[:10]:
    print("  ", e)
# 4. imports 1:1
imp_exp = sum(len(v) for v in import_map.values())
imp_act = sum(1 for e in d["edges"] if e["type"]=="imports")
print(f"imports expected={imp_exp} actual={imp_act} match={imp_exp==imp_act}")
# 5. samples
for n in d["nodes"][:2]:
    print(n["id"], "|", n["summary"][:80])
for n in [x for x in d["nodes"] if x["type"]=="function"][:2]:
    print(n["id"], "|", n["summary"][:80])
for n in [x for x in d["nodes"] if x["type"]=="class"][:2]:
    print(n["id"], "|", n["summary"][:80])
print("JSON valid, size nodes/edges/files:", len(d["nodes"]), len(d["edges"]), len(d["batchFiles"]))
