# raptix

Opinionated agent framework that builds on top of `raptix-core`. Carries
the 16 agent factories, 11 middleware implementations, tools, LLM router,
sandbox HTTP client, and skill catalogs.

This package lives in the workspace under `packages/raptix/`. See the
umbrella [`README.md`](../../README.md) for the project overview,
the [runtime boundaries](../../docs/architecture/runtime-boundaries.md) and [package dependency rules](../../docs/architecture/dependency-rules.md).

## Install

```bash
pip install raptix
```

Plugin authors should depend on `raptix-sdk` instead.
