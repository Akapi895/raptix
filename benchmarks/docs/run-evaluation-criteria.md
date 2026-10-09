# Run evaluation criteria — tool use and orchestrator/agents/workers abstraction

**Date:** 2026-10-07
**Purpose:** Criteria for verifying, on live runs (e.g. HTB Silentium), that
(1) agents genuinely use tools better (right tool for the right task, called
correctly, output understood), and (2) the orchestrator → agents → workers
abstraction is better than, or at minimum not worse than, a flat/direct
execution path.

**Reading rule:** judge from evidence in the trace (`record.jsonl`,
`events.jsonl`, artifacts), never from the agent's self-report alone.

---

## 0. What a single run can and cannot prove

- One run = **diagnostic evidence**, not an architectural verdict.
- A comparison needs: same model/profile, same prompt, same target snapshot,
  same tool inventory, same time/step budget, same hint mode, clean isolated
  workspace + KG + thread per run, and all operator interventions logged.
- Repeat runs; define **non-inferiority** thresholds up front (milestone
  outcomes and evidence must not drop beyond an agreed margin while
  cost/time must not exceed an agreed ceiling).

---

## 1. Mission outcome — the primary criterion

| Criterion | What to record |
|---|---|
| Milestones completed | recon complete → foothold → user context / user.txt → root / root.txt |
| Evidence validity | per milestone: command + output + artifact that proves it |
| Time-to-milestone | start of run → first verified evidence for each milestone |
| State truthfulness | does every `COMPLETED` objective actually satisfy its acceptance criteria? |
| Reproducibility | could another operator re-run the winning steps from the artifacts? |

Silentium-specific: watch for **false completion** — recon marked COMPLETED
while the scan was still running, output truncated, or no artifact on disk.
State must be updated only from proof.

---

## 2. Tool-use quality

### A. Choosing the right tool

Record each decision as:

```text
task → evidence in hand → tool chosen → result → next step
```

| Criterion | Good signal |
|---|---|
| Tool fits the question | the tool can actually answer the current question |
| Specialist capability preferred | a dedicated capability/tool is used when it fits and is available |
| Availability respected | right binary, profile, permissions, input prerequisites |
| Justified tool switch | switch is motivated by a specific failure or coverage gap |
| No redundant fan-out | no repeated tools producing the same evidence without purpose |

Bash is **not automatically wrong**: distinguish bash used to fill a genuine
coverage gap from bash used to bypass a suitable specialist tool.

Metrics:

- **Fit rate** — share of tool choices judged appropriate by a reviewer.
- **Skipped-specialist count** — a suitable specialist tool existed but was
  bypassed; record why each time.
- **No-evidence calls** — tool calls that produced no new evidence and served
  no verification purpose.

### B. Calling tools correctly

Track:

- Parameter/schema validity, right target, correct input/output formats.
- Prerequisites satisfied before the call.
- Timeouts and background jobs handled correctly.
- Retries only with changed conditions or a concrete reason.

Key metric: **first-call success rate**, split by error class — agent error vs
infrastructure error vs valid target response (target said "no", not "broke").

### C. Understanding and using output

- Distinguishes in-progress output from completed output?
- Checks exit status / error channels, not just the first lines of stdout?
- Converts output into artifacts / KG observations correctly?
- Is the next action actually derived from the new finding?
- Any over-interpretation (e.g. banner version treated as proof of a
  vulnerability)?

A tool succeeding is not enough — the output must be understood and must
contribute to progress.

---

## 3. Orchestration quality (orchestrator → agents → workers)

| Criterion | What to check |
|---|---|
| Objective decomposition | clear objectives with acceptance criteria, dependencies, sane scope |
| Routing | right specialist/worker per task type |
| Handoff input | objective, scope, relevant evidence, artifact refs, end conditions |
| Handoff output | results, evidence, artifacts, failure reasons, remaining gaps |
| Context sufficiency | specialists don't re-discover data already available purely because handoff was thin |
| No duplicated work | agents don't repeat recon or re-test a failed hypothesis |
| Orchestrator verification | success reports without evidence are not accepted |
| Worker discipline | scoped toolset and budget/max-steps actually enforced when workers are used |
| Error classification | target vs tool vs parser vs infrastructure vs orchestration errors kept apart |

Metrics:

- dispatches meeting acceptance criteria / total dispatches
- dispatches to the wrong role or with missing context
- duplicated tool calls attributable to thin handoff
- operator interventions required to keep the run alive
- handoff cost: time/tokens from dispatch start to first useful action

**Coverage honesty:** record the actual execution path — direct tool,
specialist, or worker. A run that never really went through workers has not
tested the worker tier; do not credit or blame that tier for its outcome.

---

## 4. Efficiency and resilience

Tracked alongside outcomes, never instead of them:

- Wall-clock time; tool/LLM wait time.
- Tokens and LLM cost where measurable.
- Tool calls, model calls, dispatches **per achieved milestone**.
- Failure loops: retrying the same way without new evidence.
- Time to detect and handle a failure.
- Recovery from timeout, malformed output, or unavailable tool.
- Scope/RoE adherence throughout the run.

Log infrastructure incidents separately — VPN drop, engagement mismatch,
missing binaries, capture loss. They shape the end-to-end experience but must
not be scored as tool-choice ability.

---

## 5. Per-run scorecard

```text
Run: ____________  Date: ________  Target: ________  Model: ________

1. Milestones + evidence:                    ____
2. False completions / unsupported claims:   ____
3. Tool fit rate / skipped specialists /
   no-evidence calls:                        ____ / ____ / ____
4. First-call success rate (by error class): ____
5. Dispatch success / wrong-role / thin-handoff
   duplication:                              ____ / ____ / ____
6. Tokens, wall-clock, per-milestone cost:   ____
7. Infra errors / agent errors / operator
   interventions:                            ____ / ____ / ____
8. Execution-path coverage (direct /
   specialist / worker):                     ____ / ____ / ____
9. Capture completeness (could every number
   above be verified from the trace?):       yes / no
10. Verdict vs criteria: better / non-inferior / worse + why
```

---

## 6. Data sources in this repo

| Source | Path | Use |
|---|---|---|
| Full-fidelity trace | `/workspace/record.jsonl` (engagement volume/bind) | model calls/responses, tool calls/outputs, fallback attempts, `agent`/`objective_id` envelopes |
| Structural audit (redacted) | `/workspace/events.jsonl` | envelopes for every call, findings |
| Raw bash sessions | `/workspace/.sessions/*.log` | exact command output |
| RoE decisions | `/workspace/audit/roe-decisions.jsonl` | scope enforcement events |
| OPPLAN snapshots | `/workspace/plan/opplan.json` | objective states over time |
| Runtime logs | `docker compose logs langgraph` | dispatch errors, reloads |
| LLM proxy logs | `docker compose logs litellm` | model traffic, token counts |
| KG | neo4j, engagement-scoped | findings/hosts/services/attack chain |

Export procedure: see `benchmarks/results/published/silentium/` run folders — copy
`events.jsonl`, `record.jsonl`, `.sessions/`, `audit/`, `report/`, both log
captures, and the rendered `transcript.md` into a dated run folder.
