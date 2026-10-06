# ADR-0039: LLM provider handlers stay in infra/config, outside the runtime package

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @PurpleCHOIms
- **Related:** `raptix-repository-architecture.md` §9 (intelligence/llm target),
  `packages/raptix/raptix/intelligence/llm/` (runtime LLM layer)

## Context

The target architecture (§9) suggests moving LLM provider implementation
files from `config/*.py` to `intelligence/llm/providers/`. In practice
these files live at `infra/config/` and are container-mount artifacts for
the LiteLLM proxy sidecar, not runtime Python modules.

Each handler (`claude_code_handler.py`, `copilot_handler.py`,
`gemini_handler.py`, `grok_handler.py`, `codex_chatgpt_handler.py`,
`perplexity_handler.py`) plus their shared support code
(`oauth_token_store.py`, `http_client.py`, `auth_handler.py`) is
deliberately written with zero dependency on the `raptix` package. Their
own docstrings explicitly state this independence. They are mounted into
the LiteLLM container at startup (`litellm_startup.py` registers them)
and never imported by any module in `packages/`.

The runtime LLM layer (`intelligence/llm/factory.py`, `router.py`) talks
to the LiteLLM HTTP proxy — it never imports these handler files
directly. The two layers are decoupled by the HTTP boundary.

## Decision

`infra/config/*_handler.py`, `oauth_token_store.py`, `http_client.py`,
`auth_handler.py`, `litellm_startup.py`, `litellm_dynamic_config.py`,
and `ollama_probe.py` stay at `infra/config/`. They are deployment glue
and container-mount artifacts, not runtime Python modules.

YAML configuration files (`litellm.yaml`, `claude4_compat.yaml`) also
stay — they are legitimately deployment config.

The architecture doc's §9 suggestion to move provider implementations
into `intelligence/llm/providers/` is not pursued. The runtime LLM layer
at `intelligence/llm/` owns model factory, provider routing, and
fallback logic — the interface between the two layers is HTTP, not
Python imports.

## Consequences

- **Easier:** the container-mount deployment model stays intact; no
  Docker build/mount path changes required; handler files remain
  testable in isolation without the `raptix` package installed.
- **Harder:** a developer looking for "all LLM code" must check both
  `intelligence/llm/` (runtime) and `infra/config/` (container-mounted
  proxy handlers). This is documented in `docs/architecture/runtime-boundaries.md`
  when that doc is written.
- **Given up:** a single-tree view of all LLM provider code. The HTTP
  boundary between runtime and proxy makes this a deployment topology
  concern, not a code organization concern.

## Alternatives considered

- **Move all handlers into `intelligence/llm/providers/`:** rejected
  because it couples deploy-time container-mount artifacts to the Python
  package graph, breaks the handlers' zero-dependency contract, and
  requires Docker build/mount path changes for no behavioral gain.
- **Move only glue code (`auth_handler.py`, `litellm_dynamic_config.py`)
  into the runtime package:** rejected because these files share the
  same container-mount lifecycle as the handlers they dispatch to;
  splitting them creates a split-brain ownership problem.
