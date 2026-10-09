#!/usr/bin/env python3
import json, pathlib
PR = "D:/.VTNet/redteam/raptix"
UA = pathlib.Path(PR) / ".ua"
batches = json.load(open(UA / "intermediate" / "batches.json", encoding="utf-8"))
for idx in [11, 12, 13, 14, 15]:
    b = [x for x in batches["batches"] if x.get("batchIndex") == idx][0]
    inp = {
        "projectRoot": "D:/.VTNet/redteam/raptix",
        "batchFiles": b["files"],
        "batchImportData": b["batchImportData"],
    }
    out = UA / "tmp" / ("ua-file-analyzer-input-%d.json" % idx)
    out.write_text(json.dumps(inp, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote %s files=%d" % (str(out), len(b["files"])))
