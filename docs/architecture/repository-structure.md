# Repository Structure

Raptix is a Python-first monorepo (uv workspace, Python 3.13) with TypeScript (Node workspaces) apps and a Go launcher.

```
raptix/
├── apps/                       # CLI (Ink/React), Web (Next.js), Desktop (Electron), Launcher (Go)
├── packages/
│   ├── raptix-core/            # Contracts, protocols, types, registry — NO runtime imports
│   ├── raptix/                 # Runtime: orchestration/knowledge/intelligence/execution/middleware/interfaces
│   ├── raptix-sdk/             # Public plugin-author API
│   └── raptix-skills/          # Skill corpus (SKILL.md files + metadata)
├── plugins/                    # Domain packs (AD, cloud, web, network, reversing, mobile, IoT, ICS, wireless, phishing, contracts)
├── infra/                      # containers/, config/, telemetry-gateway/
├── benchmarks/                 # harness.py, runner.py, scenarios, configs, results
├── tests/                      # Cross-package integration + compose isolation tests
├── docs/
│   ├── adr/                    # ADR-0001 … ADR-0041 (decisions)
│   └── architecture/           # This directory — authoritative architecture docs
└── scripts/
```

## Package split rationale

| Package | Purpose | May import |
|---------|---------|-----------|
| `raptix-core` | Types, protocols, registry contracts | stdlib only |
| `raptix-sdk` | Plugin-author surface | `raptix-core` |
| `raptix` | Runtime (agents, tools, middleware, orchestration) | `raptix-core`, third-party |
| `raptix-skills` | Skill corpus (Markdown + YAML metadata) | nothing (no Python imports) |
| Plugins | Domain agent packs | `raptix-sdk`, `raptix-core` |

See `dependency-rules.md` for the full import direction graph.
