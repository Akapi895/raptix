# Contracts domain plugin (W10)

`raptix-contracts` owns the Solidity pattern scanner, Slither observation
parser, Foundry generators, contract-auditor declaration and identity prompt.
The runtime imports this distribution; compatibility modules re-export
the original functions and classes without duplicating implementations.

## Boundary

- Imports: Python standard library, `raptix_sdk`, public `raptix_core` types.
- Framework assembly, LangChain adapters, file access and KG writes remain
  in `packages/raptix`. The SDK composition provider builds the graph.
- Skills remain in `packages/raptix-skills`. Prompt fragments are loaded from
  this distribution before the runtime adds shared policy sections.
- Scanner output and generated Solidity are unchanged by the extraction.

## Registration

The distribution registers ownership under `raptix.domains`, its subagent
under `raptix.subagents`, and identity resources under `raptix.prompt_resources`.
It also registers `contracts` under `raptix.bundles`.
Its `PluginBundle` scopes four callable tool replacements to
`contract_auditor`. Enable with `RAPTIX_PLUGINS=standard,contracts`.
LangChain converts these ordinary Python callables into tools during
agent construction. Explicit caller overrides retain precedence.

The default `standard` bundle continues to use the runtime's decorated
adapters backed by the same plugin implementation. Installing the pack
does not introduce automatic tool overrides into other bundles.

## Verification

From the repository root:

```powershell
uv sync --dev --locked
uv run pytest plugins/contracts/tests packages/raptix/tests/unit/contracts -q
uv build --package raptix-contracts --wheel
```

Plugin tests check installed entry-point discovery and enforce the import
boundary. Runtime tests exercise tool assembly, role scoping, activation,
explicit overrides, schema/output parity and compatibility identities.

Authoritative migration plan: `raptix-repository-architecture.md` §17/W10.
See `plugins/README.md` and ADR-0038 for the composition/resource contracts.
