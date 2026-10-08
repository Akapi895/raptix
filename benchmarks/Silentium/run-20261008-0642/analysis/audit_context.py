"""Deep context audit for the Silentium run record (read-only).

Replays langchain's exact count_tokens_approximately against recorded
requests to quantify: component attribution (Q02), intra-request
duplication (Q03), prefix stability (Q04), compaction events + recovery
cost (Q16), bash/captcha loop waste (Q30/Q31), errors (Q17), artifacts
(Q21), recursion budget split (Q33).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from collections import Counter, defaultdict

PATH = os.environ.get("AUDIT_RECORD", "/workspace/record.jsonl")

# ---------------------------------------------------------------- load
calls: list[dict] = []
tools_log: list[dict] = []
with open(PATH, encoding="utf-8") as fh:
    for line in fh:
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("kind") == "model_call":
            calls.append(e)
        elif e.get("kind") == "tool_call":
            tools_log.append(e)

print(f"loaded: {len(calls)} model_calls, {len(tools_log)} tool_calls")


def msg_hash(m: dict) -> str:
    return hashlib.sha256(json.dumps(m, sort_keys=True, default=str).encode()).hexdigest()[:12]


def approx_tokens_chars(text: str) -> int:
    # count_tokens_approximately core: ceil(chars/4) + 3 per message + role chars
    return text and math.ceil(max(len(text), 0) / 4.0) or 0


def classify_msgs(messages: list[dict]):
    """Yield (component, char_len) per message."""
    for i, m in enumerate(messages):
        content = m.get("content") or ""
        if isinstance(content, list):
            content = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
        tc_len = len(json.dumps(m.get("tool_calls") or [], default=str))
        total = len(content) + tc_len
        if m.get("type") == "human":
            if i == 0:
                comp = "role_prompt"
            elif "conversation that has been summarized" in content or (
                (m.get("additional_kwargs") or {}).get("lc_source") == "summarization"
            ):
                comp = "compaction_summary"
            elif "<system-reminder>" in content:
                comp = "system_reminder"
            else:
                comp = "human_other"
        elif m.get("type") == "tool":
            comp = f"tool::{(m.get('name') or '?')}"
        else:
            comp = "ai_turns"
        yield comp, total


# ------------------------------------------------- Q02 token attribution
print("\n==== Q02: token attribution ====")
per_agent_comp: dict[str, Counter] = defaultdict(Counter)
per_agent_tot: Counter = Counter()
per_agent_calls: Counter = Counter()

# top-20 largest calls detail
ranked = sorted(
    calls, key=lambda c: -int((c.get("response") or {}).get("usage", {}).get("input_tokens") or 0)
)
top_ids = {id(c) for c in ranked[:20]}

detail_lines = []
for c in calls:
    agent = c.get("agent") or "?"
    usage = (c.get("response") or {}).get("usage") or {}
    inp = int(usage.get("input_tokens") or 0)
    req = c.get("request") or {}
    msgs = req.get("messages") or []
    sysc = req.get("system") or ""
    if isinstance(sysc, list):
        sysc = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in sysc)
    comp_counter = Counter()
    comp_counter["system"] += len(sysc)
    for comp, total in classify_msgs(msgs):
        # collapse detail tool names into groups
        if comp.startswith("tool::"):
            tool = comp.split("::", 1)[1]
            if tool in {"find_skill", "load_skill", "traverse"}:
                comp = "tool::skills"
            elif tool.startswith("kg_"):
                comp = "tool::kg"
            elif tool in {"bash", "bash_output", "bash_status", "bash_kill"}:
                comp = "tool::bash"
            elif tool in {"ls", "read_file", "write_file", "edit_file", "glob", "grep"}:
                comp = "tool::files"
            else:
                comp = "tool::other"
        comp_counter[comp] += total
    per_agent_comp[agent] += comp_counter
    per_agent_tot[agent] += inp
    per_agent_calls[agent] += 1
    if id(c) in top_ids:
        detail_lines.append((inp, agent, comp_counter, len(msgs)))

print("\n-- top 20 largest calls (char shares -> % of request) --")
for inp, agent, cc, nmsg in detail_lines:
    total_chars = sum(cc.values()) or 1
    parts = ", ".join(f"{k}={v * 100.0 / total_chars:.0f}%" for k, v in cc.most_common(6))
    print(f"  {inp:>7,}t {agent:11s} nmsg={nmsg:3d} | {parts}")

print("\n-- aggregate share per agent (chars, all calls) --")
for agent in sorted(per_agent_tot, key=lambda a: -per_agent_tot[a]):
    cc = per_agent_comp[agent]
    total_chars = sum(cc.values()) or 1
    n = per_agent_calls[agent]
    print(f"  {agent:11s} calls={n:4d} provider_input={per_agent_tot[agent]:>10,}")
    for k, v in cc.most_common(10):
        avg_pct = v * 100.0 / total_chars
        avg_tokens = v / 4.0 / n
        print(f"      {k:18s} {avg_pct:5.1f}% of chars   ~{avg_tokens:>7,.0f} est-tokens/call")

# ------------------------------------------------- Q03 duplicates
print("\n==== Q03: duplicate message content within single requests ====")
dup_hits = []
for c in ranked[:30]:
    agent = c.get("agent") or "?"
    msgs = (c.get("request") or {}).get("messages") or []
    hashes = [msg_hash(m) for m in msgs]
    counts = Counter(hashes)
    dups = {h: n for h, n in counts.items() if n > 1}
    if dups:
        saved = 0
        for h, n in dups.items():
            m = next(m for m, hh in zip(msgs, hashes) if hh == h)
            saved += (n - 1) * len(str(m.get("content") or ""))
        dup_hits.append((saved, agent, sum(dups.values()), c.get("seq")))
for saved, agent, ndup, seq in sorted(dup_hits, reverse=True)[:10]:
    print(f"  seq={seq} {agent}: {ndup} duplicate messages, ~{saved:,} chars wasted")
if not dup_hits:
    print("  (none in top-30 requests)")

# ------------------------------------------------- Q04 prefix stability
print("\n==== Q04: consecutive-call prefix stability per agent ====")
by_agent_calls: dict[str, list[dict]] = defaultdict(list)
for c in calls:
    by_agent_calls[c.get("agent") or "?"].append(c)
# two processes recorded into one file with overlapping seq ranges
# (pre-resume + post-resume); ts is the only reliable global order
for _agent in by_agent_calls:
    by_agent_calls[_agent].sort(key=lambda c: (str(c.get("ts") or ""), c.get("seq", 0)))
calls.sort(key=lambda c: (str(c.get("ts") or ""), c.get("seq", 0)))

for agent, lst in by_agent_calls.items():
    lst.sort(key=lambda c: c.get("seq", 0))
    lcp_msgs, pairs, sys_same = [], 0, 0
    for a, b in zip(lst, lst[1:]):
        ma = (a.get("request") or {}).get("messages") or []
        mb = (b.get("request") or {}).get("messages") or []
        ha = [msg_hash(m) for m in ma]
        hb = [msg_hash(m) for m in mb]
        n = 0
        for x, y in zip(ha, hb):
            if x != y:
                break
            n += 1
        lcp_msgs.append(n)
        pairs += 1
        sa = json.dumps((a.get("request") or {}).get("system"), sort_keys=True, default=str)
        sb = json.dumps((b.get("request") or {}).get("system"), sort_keys=True, default=str)
        if sa == sb:
            sys_same += 1
    if pairs:
        lcp_msgs.sort()
        med = lcp_msgs[pairs // 2]
        # avg message list len
        avg_len = sum(len((c.get("request") or {}).get("messages") or []) for c in lst) / len(lst)
        print(
            f"  {agent:11s} pairs={pairs:4d} median_identical_prefix={med:3d} msgs "
            f"(avg len {avg_len:.0f})  system_identical={sys_same * 100 / pairs:.0f}%"
        )

# system block churn: distinct hashes of each system block
print("\n-- system block churn (distinct text blocks per agent) --")
for agent, lst in by_agent_calls.items():
    block_hashes: Counter = Counter()
    for c in lst:
        sysc = (c.get("request") or {}).get("system")
        if isinstance(sysc, list):
            for b in sysc:
                t = b.get("text", "") if isinstance(b, dict) else str(b)
                if t.strip():
                    block_hashes[msg_hash({"t": t})] += 1
        elif sysc and str(sysc).strip():
            block_hashes[msg_hash({"t": str(sysc)})] += 1
    print(f"  {agent:11s} distinct_system_blocks={len(block_hashes)}  calls={len(lst)}")

# ------------------------------------------------- Q16 compaction events
print("\n==== Q16: compaction events + re-orientation cost ====")
events = []
for agent, lst in by_agent_calls.items():
    prev = None
    prev_inp = 0
    for c in lst:
        inp = int(((c.get("response") or {}).get("usage") or {}).get("input_tokens") or 0)
        nmsg = len((c.get("request") or {}).get("messages") or [])
        if prev and prev_inp > 30000 and inp < prev_inp * 0.6 and nmsg <= 12:
            events.append((agent, prev, c))
        prev, prev_inp = c, inp

print(f"  total true compaction events: {len(events)}")
per_agent_events: Counter = Counter(a for a, *_ in events)
for a, n in per_agent_events.items():
    print(f"    {a}: {n}")


def _is_summary(m: dict) -> bool:
    c = str(m.get("content", ""))[:300]
    return (
        "conversation that has been summarized" in c or "summary of the conversation to date" in c
    )


for agent, pre, post in events:
    pre_inp = int(((pre.get("response") or {}).get("usage") or {}).get("input_tokens") or 0)
    post_inp = int(((post.get("response") or {}).get("usage") or {}).get("input_tokens") or 0)
    pre_msgs = (pre.get("request") or {}).get("messages") or []
    post_msgs = (post.get("request") or {}).get("messages") or []
    has_summary = any(_is_summary(m) for m in post_msgs[:3])
    lst = by_agent_calls[agent]
    idx = next(i for i, c in enumerate(lst) if c is post)
    window = lst[idx : idx + 12]
    reorient_inp = sum(
        int(((c.get("response") or {}).get("usage") or {}).get("input_tokens") or 0) for c in window
    )
    w_calls = []
    for c in window:
        for tc in (c.get("response") or {}).get("tool_calls") or []:
            w_calls.append(
                (tc.get("name"), json.dumps(tc.get("args", {}), sort_keys=True, default=str)[:120])
            )
    pre_fps = set()
    for c in lst[:idx]:
        for tc in (c.get("response") or {}).get("tool_calls") or []:
            pre_fps.add(
                (tc.get("name"), json.dumps(tc.get("args", {}), sort_keys=True, default=str))
            )
    repeats = [x for x in w_calls if (x[0], x[1]) in pre_fps]
    print(
        f"  [{agent}] {pre.get('ts', '')[11:19]}→{post.get('ts', '')[11:19]}  "
        f"{pre_inp:,}→{post_inp:,}t  nmsg {len(pre_msgs)}→{len(post_msgs)}  summary_msg={has_summary}"
    )
    print(
        f"      reorient: next12 calls input={reorient_inp:,}t  tool_calls={len(w_calls)}  repeated_pre={len(repeats)}"
    )
    for name, fp in repeats[:4]:
        print(f"        repeat: {name} {fp[:90]}")

# regrowth slope: after each compaction, input per call growth
print("\n-- regrowth slope (postexploit) --")
pe = [e for e in events if e[0] == "postexploit"]
for _agent, pre, post in pe[:6]:
    lst = by_agent_calls["postexploit"]
    idx = next(i for i, c in enumerate(lst) if c is post)
    nxt = lst[idx + 6] if idx + 6 < len(lst) else None
    if nxt:
        i0 = int(((post.get("response") or {}).get("usage") or {}).get("input_tokens") or 0)
        i6 = int(((nxt.get("response") or {}).get("usage") or {}).get("input_tokens") or 0)
        print(
            f"  {post.get('ts', '')[11:19]}: {i0:,}t →(+6 calls)→ {i6:,}t  slope≈{(i6 - i0) / 6:+,.0f}t/call"
        )

# ------------------------------------------------- Q30 bash repeats
print("\n==== Q30: bash command repeats ====")


def canon_args(args):
    return json.dumps(args, sort_keys=True, default=str)


bash_groups: dict[tuple, list[dict]] = defaultdict(list)
for t in tools_log:
    if (t.get("request") or {}).get("tool") != "bash":
        continue
    agent = t.get("agent") or "?"
    fp = canon_args((t.get("request") or {}).get("args") or {})
    bash_groups[(agent, fp)].append(t)

total_bash = sum(len(v) for v in bash_groups.values())
repeat_instances = 0
identical_resp = 0
top = sorted(bash_groups.items(), key=lambda kv: -len(kv[1]))
for (agent, fp), lst in top:
    if len(lst) < 2:
        continue
    repeat_instances += len(lst) - 1
for (agent, fp), lst in bash_groups.items():
    seen: dict[str, str] = {}
    for t in lst:
        h = msg_hash({"c": str((t.get("response") or {}).get("content") or "")[:4000]})
        if h in seen:
            identical_resp += 1
        else:
            seen[h] = t.get("ts", "")

print(f"  total bash calls={total_bash}  repeat instances (same cmd>1x)={repeat_instances}")
print(f"  repeat instances whose response was byte-identical to an earlier run: {identical_resp}")
print("  top repeated commands:")
for (agent, fp), lst in top[:10]:
    if len(lst) < 2:
        break
    cmd = str((lst[0].get("request") or {}).get("args", {}).get("command") or "?")[:100]
    print(f"    {agent:11s} x{len(lst):3d}  {cmd!r}")

# ------------------------------------------------- Q31 captcha/ocr
print("\n==== Q31: captcha/ocr loop audit ====")
cap_groups: dict[tuple, list[dict]] = defaultdict(list)
cap_total = 0
for t in tools_log:
    args = (t.get("request") or {}).get("args") or {}
    blob = canon_args(args).lower()
    if "captcha" in blob or "ocr" in blob or "tesseract" in blob:
        agent = t.get("agent") or "?"
        tool = (t.get("request") or {}).get("tool") or "?"
        cap_groups[(agent, tool, canon_args(args))].append(t)
        cap_total += 1
print(f"  tool calls touching captcha/ocr: {cap_total}")
for (agent, tool, fp), lst in sorted(cap_groups.items(), key=lambda kv: -len(kv[1]))[:8]:
    print(f"    {agent:11s} {tool:12s} x{len(lst):3d}  args={fp[:100]}")

# ------------------------------------------------- Q17 errors
print("\n==== Q17: recorded errors ====")
err_models = [c for c in calls if ((c.get("response") or {}).get("type")) == "error"]
err_tools = [t for t in tools_log if ((t.get("response") or {}).get("type")) == "error"]
print(f"  model_call errors: {len(err_models)}  tool_call errors: {len(err_tools)}")
for e in (err_models + err_tools)[:8]:
    r = e.get("response") or {}
    print(f"    seq={e.get('seq')} {e.get('agent')} {r.get('error')}: {str(r.get('detail'))[:140]}")

# ------------------------------------------------- Q21 artifacts
print("\n==== Q21: tool responses carrying artifact refs ====")
arts = [t for t in tools_log if ((t.get("response") or {}).get("artifact"))]
print(f"  tool responses with artifact field: {len(arts)} / {len(tools_log)}")
for t in arts[:5]:
    a = (t.get("response") or {}).get("artifact")
    print(f"    seq={t.get('seq')} {(t.get('request') or {}).get('tool')} artifact={str(a)[:110]}")

# ------------------------------------------------- Q33 recursion split
print("\n==== Q33: superstep budget split (per agent) ====")
task_dispatches = [t for t in tools_log if (t.get("request") or {}).get("tool") == "task"]
print(f"  task dispatches: {len(task_dispatches)}")
for t in task_dispatches:
    st = (t.get("request") or {}).get("args", {}).get("subagent_type")
    print(f"    seq={t.get('seq')} {t.get('ts', '')[11:19]} -> {st}")
for agent, lst in by_agent_calls.items():
    first, last = lst[0], lst[-1]
    print(
        f"  {agent:11s} model_calls={len(lst):4d} span {first.get('ts', '')[11:19]}→{last.get('ts', '')[11:19]}"
    )

# ------------------------------------------------- usage provenance
print("\n==== Q05: usage provenance ====")
src_counter = Counter(((c.get("response") or {}).get("usage_source") or "absent") for c in calls)
print(f"  usage_source across model_calls: {dict(src_counter)}")
detail_cache = Counter(
    json.dumps(
        ((c.get("response") or {}).get("usage") or {}).get("input_token_details") or {},
        sort_keys=True,
    )
    for c in calls
)
print(f"  input_token_details shapes: {dict(detail_cache.most_common(4))}")
