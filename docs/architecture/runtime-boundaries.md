# Runtime Boundaries

The runtime package (`packages/raptix/raptix/`) is split into subsystems with clear ownership.

```
raptix/
├── orchestration/
│   ├── phases/             # UKC macro-phase state machine (ADR-0037)
│   └── mission/            # Engagement lifecycle + OPPLAN objective tracking (ADR-0040)
├── knowledge/
│   ├── graph/              # Engagement knowledge graph (Neo4j)
│   └── ingest/             # ArtifactParser registry (scanner-output → Observation[])
├── intelligence/
│   ├── agents/             # Agent definitions (standard/ + plugins/ + build.py)
│   ├── prompts/            # Role/workflow prompt templates
│   └── llm/                # Model factory, provider router
├── capabilities/           # Capability catalog/registry, availability/eligibility evaluators —
│                           # the WHAT-resolution layer; a sibling of execution/, not nested in it
├── execution/
│   ├── tools/              # Domain tools (bash, AD, cloud, web, opplan, …)
│   ├── adapters/           # Binary-backed capability adapters (nmap, sqlmap, netexec, …)
│   ├── workers/            # Bounded-worker runner/spec for open-ended capabilities
│   ├── session/            # Event log, call recording/replay, shutdown, task spec
│   ├── sandbox/            # Kernel, server, web sandbox backends
│   └── backends/           # Backend protocol implementations
├── middleware/             # Cross-cutting adapters ONLY (budget, RoE, HITL, KG, skills, …)
├── interfaces/
│   ├── mcp/                # Model Context Protocol server
│   └── api/                # LangGraph HTTP API + checkpointer
├── skills/                 # Runtime skill loader/registry/selector/engine
├── specialist_contracts/   # Plugin/specialist capability contracts, evidence gates, scorecards
│                           # (benchmark/compliance — distinct from capabilities/ above)
├── compat/                 # Phase-1 shims (removed at 2.0.0)
└── telemetry/
```

## Ownership rules

1. Each subsystem owns its state and exposes it through protocols or public functions.
2. Middleware must be cross-cutting adapters — no subsystem state ownership (ADR-0041).
3. `orchestration/phases/` holds the UKC phase state machine; phases are runtime state, never source-tree layout.
4. `orchestration/mission/` owns engagement lifecycle and OPPLAN objectives.
5. Post-tool middleware hooks must bound work, catch failures silently, and return the original result unchanged.
6. `capabilities/` resolves WHAT (semantic capability → implementation); `execution/` performs HOW. Never re-nest one inside the other.
