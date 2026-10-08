"""Context-pressure analysis for the Silentium run record.

Quantifies: input-token distribution (the re-ship tax), per-agent split,
compaction events (sudden input drops), message-count growth, and the
largest tool responses that fed the context.
"""

import json
from collections import defaultdict

PATH = r"D:\.VTNet\phase-2\raptix\benchmarks\Silentium\run-20261008-0642\workspace\record.jsonl"

calls = []
tool_sizes = []
with open(PATH, encoding="utf-8") as f:
    for line in f:
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("kind") == "model_call":
            resp = e.get("response") or {}
            usage = resp.get("usage") or {}
            req = e.get("request") or {}
            calls.append(
                {
                    "agent": e.get("agent") or "?",
                    "ts": str(e.get("ts", ""))[:19],
                    "seq": e.get("seq", 0),
                    "inp": int(usage.get("input_tokens") or 0),
                    "out": int(usage.get("output_tokens") or 0),
                    "nmsg": len(req.get("messages") or []),
                    "ntools": len(req.get("tools") or []),
                    "sys_len": len(json.dumps(req.get("system") or "")),
                }
            )
        elif e.get("kind") == "tool_call":
            resp = str(((e.get("response") or {}).get("content")) or "")
            tool_sizes.append(
                (
                    len(resp),
                    e.get("agent") or "?",
                    str((e.get("request") or {}).get("tool") or "?"),
                    str(e.get("ts", ""))[:19],
                )
            )

tot_in = sum(c["inp"] for c in calls)
tot_out = sum(c["out"] for c in calls)
print(f"model calls: {len(calls)}   input: {tot_in:,}   output: {tot_out:,}")
print(f"avg input/call: {tot_in // max(len(calls), 1):,}")

inps = sorted(c["inp"] for c in calls)
n = len(inps)
print(
    f"input p50: {inps[n // 2]:,}   p90: {inps[int(n * 0.9)]:,}   p99: {inps[int(n * 0.99)]:,}   MAX: {inps[-1]:,}"
)

print("\n=== per-agent ===")
by_agent = defaultdict(lambda: [0, 0, 0])
for c in calls:
    a = by_agent[c["agent"]]
    a[0] += 1
    a[1] += c["inp"]
    a[2] = max(a[2], c["inp"])
for a, (cnt, tin, mx) in sorted(by_agent.items(), key=lambda kv: -kv[1][1]):
    print(f"  {a:12s} calls={cnt:5d}  input={tin:>11,}  max_single={mx:>8,}")

print("\n=== compaction candidates (same agent, input drop >40% vs prev call) ===")
drops = 0
prev = {}
for c in calls:
    a = c["agent"]
    if a in prev and prev[a]["inp"] > 30000 and c["inp"] < prev[a]["inp"] * 0.6:
        drops += 1
        if drops <= 12:
            print(
                f"  {c['ts']} [{a:11s}] {prev[a]['inp']:>8,} -> {c['inp']:>8,}  (nmsg {prev[a]['nmsg']} -> {c['nmsg']})"
            )
    prev[a] = c
print(f"  total drops: {drops}")

print("\n=== message-count growth ===")
maxmsg = max(calls, key=lambda c: c["nmsg"])
print(
    f"  max messages in one request: {maxmsg['nmsg']}  [{maxmsg['agent']} @ {maxmsg['ts']}, input {maxmsg['inp']:,}]"
)

print("\n=== biggest tool responses (context feeders) ===")
for size, agent, tool, ts in sorted(tool_sizes, reverse=True)[:12]:
    print(f"  {size:>8,}B  [{agent:11s}] {tool:12s} {ts}")
big = sum(1 for s, *_ in tool_sizes if s > 20000)
print(f"  tool responses > 20KB: {big} / {len(tool_sizes)}")
