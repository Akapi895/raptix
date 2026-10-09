import json
import re
from pathlib import Path

root = Path(r"D:/.VTNet/redteam/raptix")
bj = json.load(open(root / ".ua/intermediate/batches.json", encoding="utf-8"))
batches = {b["batchIndex"]: b for b in bj["batches"]}
ID = re.compile(r"^(file|function|class|config|document|service|table|endpoint|pipeline|schema|resource):[\w./@:+-]+$")
VN = re.compile(
    r"[àáạảãăâđêôơưạ-ỹĐđÝỹỠƯƠÂĂÊÔ]"
    r"|\b(là|của|cho|với|các|không|được|theo|khi|trả|về|từ|mà|vào|từng|nguyên|bỏ|qua|nhưng|này|thành|trong|giữa|một|những|để|đúng|đọc|ghi|gửi|tạo|hỗ trợ|phân|kiểm tra|dùng|hay|hoặc|nếu|ngoài|trước|sau|nhau|lại|cần|phải|bằng|vì|sẽ|đã|còn|nào|phục vụ|biến|thiếu|chỉ|danh|sách|giúp|làm|mọi|tự|động|chuẩn|kiểm|soát|tìm|hiểu|nhiễu|tránh|che|giữ|mạch|đến|dù|nào đó)\b",
    re.IGNORECASE,
)
tot = {}
for i in (31, 32, 33, 34, 35):
    p = root / f".ua/intermediate/batch-{i}.json"
    assert p.exists() and p.stat().st_size > 100, f"batch {i} missing/empty"
    d = json.load(open(p, encoding="utf-8"))
    b = batches[i]
    assert d["batchIndex"] == i
    assert d["batchFiles"] == b["files"], f"batch {i} batchFiles mismatch"
    for f in d["batchFiles"]:
        assert set(f) == {"path", "language", "sizeLines", "fileCategory"}
    ids = [n["id"] for n in d["nodes"]]
    assert len(ids) == len(set(ids)), f"batch {i} dup ids"
    for n in d["nodes"]:
        assert ID.match(n["id"]), n["id"]
        assert n["summary"], n["id"]
        assert VN.search(n["summary"]), f"non-VN summary: {n['id']}"
        assert 3 <= len(n["tags"]) <= 5, n["id"]
        assert n["complexity"] in ("simple", "moderate", "complex"), n["id"]
        if n["type"] in ("function", "class"):
            assert "lineRange" in n and len(n["lineRange"]) == 2, n["id"]
    for e in d["edges"]:
        assert e["source"] != e["target"], f"self edge {e}"
        assert e["direction"] == "forward"
        assert e["type"] in (
            "contains", "exports", "imports", "calls", "inherits", "implements",
            "depends_on", "tested_by", "configures", "documents", "deploys",
            "triggers", "defines_schema",
        ), e
        assert ID.match(e["source"]) and ID.match(e["target"]), e
    exp = sum(len(v or []) for v in b["batchImportData"].values())
    act = sum(1 for e in d["edges"] if e["type"] == "imports")
    assert act == exp, f"batch {i} imports {act} != {exp}"
    by = {}
    for e in d["edges"]:
        by[e["type"]] = by.get(e["type"], 0) + 1
    tot[i] = (len(d["nodes"]), len(d["edges"]), by)
    print(f"batch-{i}: OK  nodes={len(d['nodes'])} edges={len(d['edges'])} {by}")
print()
print("TOTAL nodes =", sum(v[0] for v in tot.values()), "| TOTAL edges =", sum(v[1] for v in tot.values()))
