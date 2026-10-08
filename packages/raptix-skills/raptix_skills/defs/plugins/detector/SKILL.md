---
name: detector-overview
description: Stage 2 vulnerability detector playbook. Reads source around CANDIDATE nodes and promotes real bugs to VULNERABILITY + HYPOTHESIS. Read-only. Load at detector-agent startup.
metadata:
  subdomain: orchestration
  when_to_use: "detector stage 2 vulnerability candidate vulnerability hypothesis read-only source-read pipeline"
  upstream_ref: "Raptix vulnresearch pipeline — stage 2 detector role"
---

# Detector Skill

You promote scanner candidates into `VULNERABILITY` findings — or
reject them as false positives — by reading the surrounding source.
You have no bash and no scanner tools. Your surface is source reads
(filesystem) plus `cve_lookup` / `cve_by_package`; graph reads and
writes are not on it. State flows back to the orchestrator through
your return summary.

## Per-candidate decision flow

1. Pull candidates from the task handoff — the orchestrator brief lists
   the candidate queue (path, line, score, key per candidate).
2. For each candidate (highest score first):
   a. Read ±30 lines around `path:line`. Prefer function boundaries.
   b. Identify: source? sink? taint path? sanitizer?
   c. Load the relevant playbook: `/skills/standard/analyst/<vuln-class>/SKILL.md`.
      Available classes: sql-injection, ssrf, deserialization, idor, ssti,
      xss, xxe, path-traversal, command-injection, prototype-pollution,
      prompt-injection, auth-bypass.
   d. Decide: promote, reject, or hypothesis-only.
3. Emit.

## Promotion template

Emit each decision as a `kg_record`-shaped observation in your return
summary — the orchestrator lane (which carries the KG slot) applies it
to the graph verbatim:

```json
{"kind": "Vulnerability", "key": "app.py:search_products:sqli",
 "label": "SQLi in product search",
 "props": {"severity": "high", "file": "/workspace/target/app.py",
           "line": 142, "cwe": ["CWE-89"],
           "source": "request.args.get(\"q\")", "sink": "cursor.execute",
           "evidence": "cursor.execute(f\"SELECT * FROM products WHERE name LIKE '%{q}%'\")"},
 "edges_out": [{"to_key": "candidate::<candidate-key>", "kind": "DERIVED_FROM"}]}
```

plus a companion Hypothesis observation (key
`app.py:search_products:sqli:hyp`, label "Unsanitized query param flows
into f-string SQL") with
`{"to_key": "app.py:search_products:sqli", "kind": "MAPS_TO"}`.

## Rejection template

Same observation — SAME `kind` + `key` — with `"status": "rejected"`
and `"reason": "sanitized via html.escape before sink"` added to
`props`. The graph upsert is idempotent: the rejection merges on top
of the original candidate.

## Severity calibration

| Signal                                                     | Severity  |
|------------------------------------------------------------|-----------|
| Unauth + external input + dangerous sink + no sanitizer    | critical  |
| Authed + dangerous sink, or unauth + partial sanitization  | high      |
| Requires specific input shape or edge case                 | medium    |
| Theoretically reachable, requires multiple prereqs         | low       |

## Anti-patterns

- Reading entire files. 30–200 lines is the ceiling.
- Emitting more than one `VULNERABILITY` per (file, function, sink).
- Running scanner tools ("let me re-scan this area"). Not your job.
- Writing bash commands. You do not have bash.
