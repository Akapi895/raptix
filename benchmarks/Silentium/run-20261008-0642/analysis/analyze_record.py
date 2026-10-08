import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone

PATH = r"D:\.VTNet\phase-2\raptix\benchmarks\Silentium\run-20261008-0642\workspace\record.jsonl"

model_calls = []
tool_calls = []
entries = 0
kinds = Counter()
first_ts = last_ts = None

with open(PATH, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        entries += 1
        kinds[e.get("kind", "?")] += 1
        ts = e.get("ts")
        if isinstance(ts, str):
            try:
                ts = float(ts)
            except ValueError:
                try:
                    ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
                except ValueError:
                    ts = None
        if ts:
            if first_ts is None:
                first_ts = ts
            last_ts = ts
        if e.get("kind") == "model_call":
            model_calls.append(e)
        elif e.get("kind") == "tool_call":
            tool_calls.append(e)


def agent_of(e):
    return e.get("agent") or "?"


def usage_of(e):
    resp = e.get("response") or {}
    u = resp.get("usage") or {}
    return (
        u.get("input_tokens") or 0,
        u.get("output_tokens") or 0,
        u.get("total_tokens") or 0,
    )


print(f"=== ENTRIES: {entries}  kinds: {dict(kinds)}")
if first_ts and last_ts:
    dur = last_ts - first_ts
    t0 = datetime.fromtimestamp(first_ts, tz=timezone.utc).isoformat()
    t1 = datetime.fromtimestamp(last_ts, tz=timezone.utc).isoformat()
    print(f"=== WALL CLOCK: {dur / 3600:.2f} h  ({t0} -> {t1})")

print("\n=== MODEL CALLS per agent ===")
mc_agent = Counter(agent_of(e) for e in model_calls)
for a, n in mc_agent.most_common():
    print(f"  {a:20s} {n}")

tok_in = tok_out = tok_total = 0
tok_with_usage = 0
for e in model_calls:
    i, o, t = usage_of(e)
    if t:
        tok_with_usage += 1
    tok_in += i
    tok_out += o
    tok_total += t
print(f"\n=== TOKENS (model_call entries with usage: {tok_with_usage}/{len(model_calls)}) ===")
print(f"  input={tok_in:,}  output={tok_out:,}  total={tok_total:,}")

resp_has_text = sum(1 for e in model_calls if (e.get("response") or {}).get("content"))
print(f"  model responses with content: {resp_has_text}/{len(model_calls)}")

req_hashes = Counter(e.get("req_hash") for e in model_calls)
dup_model = sum(c - 1 for c in req_hashes.values() if c > 1)
max_model_dup = max(req_hashes.values()) if req_hashes else 0
print(f"  byte-identical model requests: {dup_model} surplus (max cluster {max_model_dup})")

print("\n=== TOOL CALLS per tool ===")
tc_tool = Counter((e.get("request") or {}).get("tool", "?") for e in tool_calls)
for t, n in tc_tool.most_common(30):
    print(f"  {t:20s} {n}")

print("\n=== TOOL CALLS per agent ===")
tc_agent = Counter(agent_of(e) for e in tool_calls)
for a, n in tc_agent.most_common():
    print(f"  {a:20s} {n}")

bash_cmds = []
for e in tool_calls:
    req = e.get("request") or {}
    if req.get("tool") == "bash":
        args = req.get("args") or {}
        cmd = args.get("command") or args.get("cmd") or ""
        bash_cmds.append((agent_of(e), cmd))

timeout_prefixed = sum(1 for _, c in bash_cmds if re.match(r"^\s*(timeout|sleep\s+\d+\s*&&)", c))
print(
    f"\n=== BASH: {len(bash_cmds)} calls; timeout/timeboxed prefix: {timeout_prefixed} ({100 * timeout_prefixed / max(1, len(bash_cmds)):.0f}%)"
)

cmd_clusters = Counter()
for a, c in bash_cmds:
    h = hashlib.md5(c.encode()).hexdigest()
    cmd_clusters[(a, h, c[:120])] += 1
dup_bash = sum(c - 1 for c in cmd_clusters.values() if c > 1)
big = [(n, a, c) for (a, h, c), n in cmd_clusters.most_common(10) if n >= 5]
print(f"  identical bash commands: {dup_bash} surplus; clusters >=5: {len(big)}")
for n, a, c in big:
    print(f"    {n:4d}x [{a}] {c}")

print("\n=== TASK DISPATCHES ===")
dispatches = []
for e in tool_calls:
    req = e.get("request") or {}
    if req.get("tool") == "task":
        args = req.get("args") or {}
        desc = str(args.get("description") or args.get("prompt") or "")[:110]
        dispatches.append((agent_of(e), desc))
print(f"  total dispatches: {len(dispatches)}")
for a, d in dispatches:
    print(f"    [{a}] {d}")

print("\n=== SKILL USAGE ===")
load_skill = [
    (agent_of(e), (e.get("request") or {}).get("args") or {})
    for e in tool_calls
    if (e.get("request") or {}).get("tool") == "load_skill"
]
sk_names = Counter()
for a, args in load_skill:
    p = str(args.get("name_or_path") or args.get("name") or "?")
    sk_names[p] += 1
for p, n in sk_names.most_common(20):
    print(f"  {n:3d}x  {p}")
zero_find = 0
find_skill_total = 0
for e in tool_calls:
    req = e.get("request") or {}
    if req.get("tool") == "find_skill":
        find_skill_total += 1
        content = str((e.get("response") or {}).get("content") or "")
        if (
            "0 result" in content.lower()
            or "no skill" in content.lower()
            or content.strip() == "[]"
        ):
            zero_find += 1
print(f"  find_skill: {find_skill_total} calls, {zero_find} empty")

print("\n=== ERROR CLASSES in tool results ===")
err_pat = {
    "timeout": re.compile(r"timeout|timed out", re.I),
    "killed": re.compile(r"\[KILLED\]", re.I),
    "readonly_db": re.compile(r"SQLITE_READONLY", re.I),
    "unauthorized": re.compile(r"Unauthorized|401|403", re.I),
    "not_found": re.compile(r"path_not_found|file_not_found|No such file", re.I),
    "conn": re.compile(r"Connection refused|Name or service not known|unreachable", re.I),
}
err_counts = Counter()
for e in tool_calls:
    content = str((e.get("response") or {}).get("content") or "")
    for name, pat in err_pat.items():
        if pat.search(content):
            err_counts[name] += 1
for name, n in err_counts.most_common():
    print(f"  {name:14s} {n}")

print("\n=== ROOT VECTOR DISCOVERY ===")
cve_hits = Counter()
for e in tool_calls + model_calls:
    blob = json.dumps(e)[:200000]
    for pat, label in [
        (r"CVE-2025-8110", "CVE-2025-8110"),
        (r"symlink", "symlink"),
        (r"staging-v2-code", "vhost discovery"),
        (r"PutContents", "NVD desc"),
    ]:
        if re.search(pat, blob, re.I):
            cve_hits[label] += 1
for label, n in cve_hits.most_common():
    print(f"  {label}: {n} entries mention")

# first mention seq/ts of CVE-2025-8110 and symlink in bash commands
first_cve = first_sym = None
for e in tool_calls + model_calls:
    blob = json.dumps(e)
    ts = e.get("ts")
    if first_cve is None and "CVE-2025-8110" in blob:
        first_cve = ts
    if first_sym is None and re.search(r"ln -s|symlink", blob, re.I):
        first_sym = ts
    if first_cve and first_sym:
        break
for label, t in [("first CVE-2025-8110 mention", first_cve), ("first symlink mention", first_sym)]:
    if isinstance(t, str):
        try:
            t = datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()
        except ValueError:
            t = float(t)
    if t is not None and first_ts is not None:
        dt = datetime.fromtimestamp(t, tz=timezone.utc).isoformat()
        print(f"  {label}: {dt} (+{(t - first_ts) / 3600:.2f}h from start)")
    else:
        print(f"  {label}: NEVER")
