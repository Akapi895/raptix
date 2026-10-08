import json

PATH = r"D:\.VTNet\phase-2\raptix\benchmarks\Silentium\run-20261008-0642\workspace\record.jsonl"
cap = []
fake = 0
ok = 0
capres = []
with open(PATH, encoding="utf-8") as f:
    for line in f:
        try:
            e = json.loads(line)
        except Exception:
            continue
        req = e.get("request") or {}
        if req.get("tool") in (
            "cve_lookup",
            "cve_poc_lookup",
            "cve_by_package",
            "research_cve",
            "search_security_references",
        ):
            args = json.dumps(req.get("args") or {})[:120]
            resp = str((e.get("response") or {}).get("content") or "")[:160]
            capres.append((req["tool"], args, resp))
        if req.get("tool") == "bash":
            c = str((req.get("args") or {}).get("command") or "")
            if "captcha3.png" in c and "PIL" in c:
                r = str((e.get("response") or {}).get("content") or "")
                capres.append(("CAPTCHA-OCR", c[:80], r[:120]))
print("== research tool calls:", len(capres))
for t, a, r in capres[:25]:
    print(f"[{t}] {a}")
    print(f"   -> {r}")
