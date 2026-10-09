import json

PATH = r"D:\.VTNet\phase-2\raptix\benchmarks\Silentium\run-20261008-0642\workspace\record.jsonl"

entries = []
with open(PATH, encoding="utf-8") as f:
    for line in f:
        try:
            entries.append(json.loads(line))
        except Exception:
            pass

for idx in (116, 122, 126, 132, 134, 146):
    e = entries[idx]
    req = e.get("request") or {}
    resp = str(((e.get("response") or {}).get("content")) or "")
    cmd = str((req.get("args") or {}).get("command") or "")
    print(f"\n{'='*80}\n#{idx} [{e.get('agent','?')}] {str(e.get('ts',''))[:19]}")
    print(f"CMD: {cmd[:180]}")
    print(f"RESP ({len(resp)}B):")
    print(resp[:1500])
