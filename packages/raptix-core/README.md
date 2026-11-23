# raptix-core

The Raptix contract layer. Pure types, protocols, plugin contracts,
and registry primitives — zero `langchain` / `langgraph` / `deepagents`
runtime dependency. Suitable to import from any context: CLI tooling,
serverless workers, type-checking-only environments.

Stable surface for plugin authors and downstream commercial layers
(e.g. dashboards, B2B API services). See the umbrella
[`README.md`](../../README.md) and the [package dependency rules](../../docs/architecture/dependency-rules.md).

## Install

```bash
pip install raptix-core
```

Most consumers should install `raptix` (which depends on this) or
`raptix-sdk` (the plugin-author entrypoint).
