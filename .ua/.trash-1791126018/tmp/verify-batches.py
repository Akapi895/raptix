import json, os, sys
ROOT = r"D:\.VTNet\redteam\raptix"
UA = os.path.join(ROOT, ".ua")
with open(os.path.join(UA, "intermediate", "batches.json"), encoding="utf-8") as f:
    BJSON = json.load(f)
BATCHES = {b["batchIndex"]: b for b in BJSON["batches"]}
# all paths across all batches with their fileCategory
ALLCAT = {}
for b in BJSON["batches"]:
    for f in b["files"]:
        ALLCAT[f["path"]] = f["fileCategory"]
def prefix_for(cat):
    return {"docs": "document:", "config": "config:", "code": "file:"}.get(cat, "file:")
ok = True
for idx in (136, 137, 138, 139, 140):
    path = os.path.join(UA, "intermediate", "batch-%d.json" % idx)
    raw = open(path, "rb").read()
    raw.decode("utf-8")  # utf-8 validity
    assert not raw.startswith(b"\xef\xbb\xbf"), "BOM found"
    d = json.loads(raw.decode("utf-8"))
    errs = []
    if d["batchIndex"] != idx: errs.append("batchIndex mismatch")
    bf = d["batchFiles"]
    orig = BATCHES[idx]["files"]
    if len(bf) != len(orig): errs.append("batchFiles count")
    for a, b in zip(bf, orig):
        if sorted(a.keys()) != sorted(["path","language","sizeLines","fileCategory"]) or a != b:
            errs.append("batchFiles verbatim mismatch: %s" % a.get("path"))
    ids = {n["id"] for n in d["nodes"]}
    # every batch file has a node
    for f in bf:
        pre = prefix_for(f["fileCategory"]) if f["fileCategory"] != "code" or not f["path"].endswith(".py") else "file:"
        if f["path"].endswith(".py"): pre = "file:"
        want_doc = pre + f["path"]
        if f["path"].endswith((".md", ".json", ".py")) and want_doc not in ids:
            errs.append("missing node for %s" % f["path"])
    for n in d["nodes"]:
        if not n["id"].startswith(("file:","config:","document:","function:","class:","service:","schema:","endpoint:","pipeline:","resource:","table:")):
            errs.append("bad id: %s" % n["id"])
        if n["id"] in ("file:","config:","document:"): errs.append("bare prefix")
        if n["filePath"].startswith("packages/") is False: errs.append("filePath not relative: %s" % n["filePath"])
        if not n["summary"] or not n["tags"] or len(n["tags"]) < 3 or n["complexity"] not in ("simple","moderate","complex"):
            errs.append("bad node fields: %s" % n["id"])
        if n["lineRange"][0] > n["lineRange"][1]: errs.append("bad lineRange %s" % n["id"])
    for e in d["edges"]:
        if e["source"] == e["target"]: errs.append("self-edge: %s" % e["source"])
        for endp in (e["source"], e["target"]):
            base = endp.split(":",1)[1] if ":" in endp else ""
            if endp not in ids:
                # cross-batch: must be a known project path
                if base not in ALLCAT:
                    errs.append("edge endpoint unknown: %s" % endp)
                elif "function:" in endp or "class:" in endp:
                    errs.append("cross-batch symbol endpoint: %s" % endp)
    # import edge count matches batchImportData
    nimp = sum(len(v) for v in BATCHES[idx]["batchImportData"].values())
    have_imp = sum(1 for e in d["edges"] if e["type"] == "imports")
    if nimp != have_imp: errs.append("imports mismatch: expected %d got %d" % (nimp, have_imp))
    dup = len(ids) != len(d["nodes"])
    if dup: errs.append("duplicate node ids")
    status = "OK" if not errs else "ERRORS"
    print("batch %d: %s nodes=%d edges=%d %s" % (idx, status, len(d["nodes"]), len(d["edges"]), "; ".join(errs[:5])))
    if errs: ok = False
print("ALL OK" if ok else "FAILURES")
