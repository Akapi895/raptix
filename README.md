# Raptix — A Multi-Agent System for Red Team Engagements

Raptix is a research project on using a group of LLM-based agents to support an authorized red team engagement, from reconnaissance through initial foothold, privilege escalation, lateral movement and command and control (C2). It is designed for authorized targets in isolated test environments only.

## The problem

After each step of an engagement, a tester usually has several possible next actions. Choosing among them means deciding which lead to follow first, which findings are reliable enough to act on, and which tasks can safely run in parallel. Raptix aims to support these decisions while producing evidence that can be checked afterwards.

## Approach

- **Engagement setup.** A planning agent produces the engagement package: Rules of Engagement (RoE), a concept of operations (ConOps) and a deconfliction plan. An orchestrator then builds an operation plan (OPPLAN) whose objectives are mapped to MITRE ATT&CK, and waits for operator approval before dispatching work.
- **Orchestrator and specialists.** The orchestrator reads the OPPLAN and the current attack knowledge graph, selects the next objective and delegates it to a specialist agent such as recon, exploit or post-exploitation. The orchestrator does not run offensive commands itself.
- **Execution in a sandbox.** Specialists run tools inside an isolated Kali Linux sandbox, using persistent terminal sessions so that interactive tools work.
- **Shared state.** Observations are stored in a Neo4j attack knowledge graph, so planning depends on recorded evidence rather than on conversation history alone.
- **Safety controls.** Actions are checked against RoE and network egress limits, high-impact actions require human approval, and output from targets is treated as untrusted input.
- **Controlled parallelism.** Each task is classified by its effect and the resources it uses. An admission policy decides whether tasks may run concurrently, so that fragile services are not overloaded.

## Goals

- Keep every conclusion traceable to evidence collected during the engagement.
- Bound the number of tasks so that exploration does not grow without limit.
- Measure how the safety and concurrency controls affect results on lab targets.

## Status

Work in progress. The core architecture, the knowledge graph and the fan-out control logic are implemented. Evaluation on lab environments and benchmarks is ongoing, and the operator interface is still being integrated.
