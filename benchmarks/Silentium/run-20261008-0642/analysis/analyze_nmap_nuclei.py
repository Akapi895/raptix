import json
import re
from collections import Counter

PATH = r"D:\.VTNet\phase-2\raptix\benchmarks\Silentium\run-20261008-0642\workspace\record.jsonl"

entries = []
with open(PATH, encoding="utf-8") as f:
    for line in f:
        try:
            entries.append(json.loads(line))
        except Exception:
            pass

print(f"total entries: {len(entries)}")

# --- all nmap invocations
nmap_calls = []
for i, e in enumerate(entries):
    if e.get("kind") != "tool_call":
        continue
    req = e.get("request") or {}
    if req.get("tool") != "bash":
        continue
    cmd = str((req.get("args") or {}).get("command") or "")
    if re.search(r"(?<![a-z0-9_-])nmap(?![a-z0-9_-])", cmd):
        resp = str(((e.get("response") or {}).get("content")) or "")
        open_ports = re.findall(r"^\s*(\d+/[a-z]+)\s+open[^\n]*", resp, re.M)
        nmap_calls.append({
            "idx": i,
            "ts": str(e.get("ts", ""))[:19],
            "agent": e.get("agent", "?"),
            "cmd": re.sub(r"\s+", " ", cmd).strip(),
            "ports": open_ports,
        })

print(f"\n=== NMAP invocations: {len(nmap_calls)} ===")
for c in nmap_calls:
    print(f"\n#{c['idx']} {c['ts']} [{c['agent']}]")
    print(f"  cmd: {c['cmd'][:260]}")
    if c["ports"]:
        print(f"  open: {', '.join(p.split('/')[0] for p in c['ports'])}")

norm = Counter(re.sub(r"\s+", " ", c["cmd"]).strip() for c in nmap_calls)
print(f"\n=== distinct nmap command lines: {len(norm)} ===")
for cmd, n in norm.most_common():
    print(f"  x{n}  {cmd[:200]}")

# --- installed-but-unused tool usage
print("\n=== usage of installed-but-maybe-unused tools ===")
for t in ["nuclei", "httpx", "katana", "testssl", "hydra", "sqlmap", "smbclient",
          "enum4linux", "searchsploit", "whatweb", "wpscan", "dnsrecon", "dig",
          "whois", "snmpwalk", "nxc", "netexec"]:
    n = sum(1 for e in entries
            if e.get("kind") == "tool_call"
            and (e.get("request") or {}).get("tool") == "bash"
            and re.search(rf"(?<![a-z0-9_-]){re.escape(t)}(?![a-z0-9_-])",
                          str(((e.get("request") or {}).get("args") or {}).get("command") or "")))
    print(f"  {t:14s} {n}")

# --- dispatch timeline for mapping
print("\n=== dispatches (task tool calls) ===")
for i, e in enumerate(entries):
    if e.get("kind") != "tool_call":
        continue
    req = e.get("request") or {}
    if req.get("tool") == "task":
        blob = json.dumps(req.get("args") or {})
        obj = re.search(r"OBJ-\d+", blob)
        print(f"  #{i} {str(e.get('ts',''))[:19]} [{e.get('agent','?')}] {obj.group(0) if obj else '?'}")
