# Dependency Rules

## Import direction graph

```
Apps  →  Runtime  →  Core
          ↑
         SDK ←→ Core
          ↑
        Plugins → SDK/Core only
          ↑
        Skills (consumed by runtime skill loader, no Python imports)
```

## Per-package rules

| Package | May import | Must NOT import |
|---------|-----------|----------------|
| `raptix-core` | stdlib, `dataclasses`, `typing` | Any runtime framework (LangChain, FastAPI, neo4j, httpx, docker, playwright) |
| `raptix-sdk` | `raptix-core` | `raptix` runtime internals |
| `raptix` (runtime) | `raptix-core`, third-party | — |
| Plugins | `raptix-sdk`, `raptix-core`, stdlib | `raptix` runtime internals |
| Skills | Nothing (Markdown + YAML) | Any Python package |
| Apps | `raptix` public surface | Deep runtime internals |

## Enforcement

These rules are enforced by structural tests (W13):

- `packages/raptix-sdk/tests/test_no_runtime_internals_import.py` — AST-walk asserts SDK never imports `raptix.*`
- `tests/test_apps_have_no_python_runtime_imports.py` — asserts apps/ contain no unauthorized Python runtime imports
- `packages/raptix-skills/tests/test_no_runtime_logic.py` — asserts skill corpus has no runtime imports
- `packages/raptix/tests/unit/orchestration/test_no_phase_source_tree.py` — asserts UKC phases don't leak into source tree

## Exceptions

- `infra/config/` LLM provider handlers: zero `raptix` dependency by design (ADR-0039)
- `apps/web/tools/` build scripts: allowlisted, AST-checked for forbidden imports
