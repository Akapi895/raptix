# ADR-0038: Declarative domain plugins and runtime composition

Status: Proposed (implementation authorized for W10)
Date: 2026-10-05

## Context

W10 in `raptix-repository-architecture.md` moves domain ownership to
first-party plugin packs. Existing agent factories import private runtime
builders. Moving those imports into plugins would violate the SDK/core
dependency direction. Replacing a complete prompt with only a domain
fragment would also discard shared policy sections.

## Decision

Core owns a frozen `DomainAgentDefinition` describing role, baseline tool
capabilities, skill sources, recursion limit and subagent metadata. The
SDK exposes `create_domain_agent` and `domain_subagent`; composition is
dispatched through the installed `raptix.agent_composers` entry-point.
The runtime implements that entry-point using its existing model,
sandbox, tool, prompt and middleware builders.

Plugins import only SDK/core contracts. They own domain definitions and
domain analysis implementations. Runtime adapters retain framework,
transport, engagement/KG lifecycle and cross-cutting assembly concerns.
Existing graph import paths remain thin graph-hosting compatibility
modules; subagent entry-points are owned by plugin distributions.

Core also describes package-backed `PromptResource` contributions.
Runtime resolves these through `raptix.prompt_resources` as identity or
workflow fragments before ordinary prompt assembly. Shared policies,
language selection, cache boundaries and prompt overrides keep their
existing ordering. The centralized skill corpus stays in `raptix-skills`;
plugins declare the same virtual skill sources.

## Invariants and failure behavior

- No guardrail slots or tool execution controls are changed.
- Default role names, tool sets, subagent order and bundle membership stay.
- Missing/ambiguous composers and duplicate resource names fail explicitly.
- Resource paths are package-relative and cannot traverse outside their pack.
- Plugins import no runtime or LangChain/LangGraph implementation modules.
- Compatibility exports refer to the canonical plugin implementation.

### Threat model

Only installed Python distribution entry-points supply composers and
resources; there is no remote provider lookup or caller-controlled file
read. Prompt paths are confined to their declaring package. Missing or
ambiguous ownership fails explicitly. The composer continues through the
existing middleware safety-override gate and standard sandbox/context
builders. Transport, command dispatch and KG lifecycle remain in runtime
adapters. Semgrep's production-code path coverage is extended to plugin
sources; no existing rule or exclusion is relaxed.

## Verification

Test public contracts and composer failure paths without frameworks;
compare domain metadata, default tool sets and fragment contents; exercise
runtime composition with injected model/sandbox dependencies; verify prompt
policy assembly and installed wheel/entry-point discovery. Run lint,
typecheck and the fast regression lane after each extraction group.

## Consequences

The SDK gains an explicit composition boundary. Plugins can be imported
and inspected without constructing agents or requiring the runtime. Agent
execution requires an installed runtime composer. Live transport and KG
adapters stay runtime-owned rather than being copied into plugin packages.
