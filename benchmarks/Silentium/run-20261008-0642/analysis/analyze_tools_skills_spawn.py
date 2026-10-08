import json
import re
from collections import Counter, defaultdict

PATH = r"D:\.VTNet\phase-2\raptix\benchmarks\Silentium\run-20261008-0642\workspace\record.jsonl"

entries = []
with open(PATH, encoding="utf-8") as f:
    for line in f:
        try:
            e = json.loads(line)
        except Exception:
            continue
        entries.append(e)

SEC_TOOLS = [
    "nmap",
    "gobuster",
    "nikto",
    "sqlmap",
    "nuclei",
    "ssh",
    "sshpass",
    "scp",
    "curl",
    "wget",
    "nc",
    "ncat",
    "socat",
    "netexec",
    "nxc",
    "enum4linux",
    "smbclient",
    "ldapsearch",
    "hydra",
    "john",
    "hashcat",
    "wpscan",
    "ffuf",
    "dirb",
    "whatweb",
    "dnsrecon",
    "dig",
    "whois",
    "snmpwalk",
    "openssl",
    "python3",
    "pip",
    "tmux",
    "git",
    "mysql",
    "psql",
    "sqlite3",
    "base64",
    "openssl",
    "ddddocr",
]

# ---- 1. bash command inventory
first_tok = Counter()
tool_hits = Counter()
bash_by_agent = defaultdict(Counter)
for e in entries:
    if e.get("kind") != "tool_call":
        continue
    req = e.get("request") or {}
    if req.get("tool") != "bash":
        continue
    agent = e.get("agent") or "?"
    cmd = str((req.get("args") or {}).get("command") or "")
    # strip env prefixes / cd
    m = re.search(r"(?:^|&&|;|\|\||\|\s*)([a-zA-Z0-9_./-]+)", cmd)
    tok = m.group(1).split("/")[-1] if m else "?"
    first_tok[tok] += 1
    bash_by_agent[agent][tok] += 1
    for t in SEC_TOOLS:
        if re.search(rf"(?<![a-z0-9_-]){re.escape(t)}(?![a-z0-9_-])", cmd):
            tool_hits[t] += 1

print("=== SECURITY-TOOL mentions in bash commands ===")
for t, n in tool_hits.most_common(30):
    print(f"  {t:12s} {n}")

print("\n=== first-token distribution (top 25) ===")
for t, n in first_tok.most_common(25):
    print(f"  {t:16s} {n}")

print("\n=== per-agent bash profile ===")
for a, c in bash_by_agent.items():
    print(f"  [{a}] " + ", ".join(f"{t}:{n}" for t, n in c.most_common(8)))

# ---- 2. dispatch detail
print("\n=== DISPATCHES (agent spawned, session, objective) ===")
seq_dispatch = []
for e in entries:
    if e.get("kind") != "tool_call":
        continue
    req = e.get("request") or {}
    if req.get("tool") == "task":
        args = req.get("args") or {}
        blob = json.dumps(args)
        agent_m = re.findall(r'"(\w+)"\s*:\s*"([^"]{0,40})"', blob)
        name = args.get("name") or args.get("agent") or args.get("agent_name") or ""
        sess = re.search(r"session name:\s*([\w.-]+)", json.dumps(args))
        obj = re.search(r"OBJ-\d+", blob)
        ts = e.get("ts")
        seq_dispatch.append(
            (ts, name, sess.group(1) if sess else "?", obj.group(0) if obj else "?")
        )
for ts, name, sess, obj in seq_dispatch:
    t = ts[:19] if isinstance(ts, str) else ts
    print(f"  {t}  agent={name or '?':14s} session={sess:24s} {obj}")

# ---- 3. skill timeline per agent
print("\n=== SKILL LOADS (chronological, with result) ===")
for e in entries:
    if e.get("kind") != "tool_call":
        continue
    req = e.get("request") or {}
    if req.get("tool") == "load_skill":
        args = req.get("args") or {}
        p = str(args.get("name_or_path") or args.get("name") or "?")
        resp = str((e.get("response") or {}).get("content") or "")
        ok = "ERR" if ("error" in resp[:80].lower() or "no skill" in resp[:80].lower()) else "ok"
        n = len(resp)
        print(f"  {e.get('ts', '')[:19]} [{e.get('agent', '?'):11s}] {ok:3s} {n:>6d}B  {p}")

print("\n=== FIND_SKILL queries ===")
for e in entries:
    if e.get("kind") != "tool_call":
        continue
    req = e.get("request") or {}
    if req.get("tool") == "find_skill":
        args = req.get("args") or {}
        resp = str((e.get("response") or {}).get("content") or "")
        nl = resp.count("\n")
        print(
            f"  {e.get('ts', '')[:19]} [{e.get('agent', '?'):11s}] q={str(args)[:70]}  ~{nl} lines"
        )
