# 0092. One runtime and sandbox per project, one active project per deployment

- **Status:** Proposed
- **Date:** 2026-10-19
- **Deciders:** requester (repository owner) approved the direction on 2026-10-19. Maintainer acceptance is pending.
- **Related:** [ADR-0082](0082-dedicated-web-execution-plane.md) (Proposed; its shared web-runtime topology is partly superseded here), [ADR-0086](0086-per-run-sandbox-workspace-isolation.md) (Accepted; its shared-volume subpath sandbox is partly superseded here), [ADR-0089](0089-pin-instance-delivery-and-controls-to-attempts.md) (Proposed; unchanged), [ADR-0090](0090-trusted-engagement-identity-and-operator-grants.md) (Accepted; identity and grant rules are kept), [ADR-0091](0091-handoff-authorizes-execution.md). Design: [`docs/design/2026-10-19-single-active-project-environments-implementation-plan.md`](../design/2026-10-19-single-active-project-environments-implementation-plan.md).

## Context

Today the CLI pins one engagement through the global `.env` (`RAPTIX_ENGAGEMENT`) and talks to one raw LangGraph URL. The web stack runs one `web-runtime` for every project, and each project sandbox mounts a subpath of one shared workspace volume. The management plane has no per-project authorization on the runtime and sandbox HTTP APIs, so a sandbox can reach peer sandboxes and the shared runtime. Switching project therefore means editing `.env`, restarting the CLI, or accepting that a peer's files and threads are reachable.

The single-active requirement (one project running per deployment, shared by Web, CLI and background callers) does not remove the need for isolation. Fewer live projects reduces exposure but does not make a shared runtime safe: runtime state, checkpoints and mailboxes are process-local, and the sandbox network is shared.

## Decision

1. **Each project environment has its own LangGraph runtime container and sandbox container.** Its workspace is mounted at `/workspace/<workspaceSlug>` and its runtime state at `/app/.langgraph_api`. No container mounts a parent directory that holds other projects.
2. **At most one environment is active per deployment.** A single slot record per deployment, changed only by compare-and-set on a version, is the admission authority. Web, CLI, scheduler and copilot all pass through it. Lease expiry and controller heartbeat loss never release the slot; only an observed stop does.
3. **Environment lifecycle is a control-plane intent.** Fastify owns the durable registry, command ledger and slot. The host controller is a trusted, host-local module in the launcher. It runs only allowlisted `ensure/start/observe/stop/recreate/remove` operations on resources labelled with the deployment, project, environment and generation. It is not reachable from the browser, the LLM, or any runtime or sandbox. The Docker socket is never mounted into Fastify, runtime or sandbox containers.
4. **Shared services stay shared, and their data is not.** Images, the LiteLLM model proxy, and the read-only corpus are shared. Postgres, Neo4j and the workflow database are shared infrastructure. A project runtime reaches shared data only through credentials scoped to that project, or through a typed facade that binds the project from the caller credential. Arbitrary Cypher or a database admin credential is not granted to a runtime.
5. **Activation does not grant execution authority.** Starting an environment does not approve tools, skip HITL, bypass ROE or preflight, or change the stop semantics. Those gates are unchanged.
6. **Legacy paths are not silently merged.** Each project declares a routing mode, `legacy` or `environment`. There is no automatic fallback from a new endpoint to the old shared runtime, and the legacy and environment runtimes never write the same workspace or checkpoint store at the same time.

This ADR does not weaken any guard rail. `SafeCommand`, `EngagementContext`, RoE enforcement, the `opsec` skill wording, the `.semgrep/raptix-no-*` rules, `allowed-tools:` frontmatter, and the container hardening in `docker-compose.yml` are unchanged. Any later change to them needs its own ADR.

## Consequences

- **Easier:** a project's files, checkpoints and mailbox state are reachable only from its own containers. Switching project is an admitted command, not an edit to `.env`. Stop and restart keep workspace and history.
- **Harder:** each environment needs its own runtime process, so memory use grows with the number of running environments (one active environment at a time limits this). Every project-scoped call must resolve its environment first. Startup has a controller dependency that the current single-runtime path does not have.
- **Given up:** the current shared `web-runtime` and `web-sandbox` as the default project path, and the global `RAPTIX_ENGAGEMENT` pin as the way to choose a project.
- **Migration:** existing projects are migrated per project under a legacy routing mode with inventory, backup and rehearsal first. This is planned for phase I07 and is not done by this ADR.
- **Limits:** this does not protect against a compromised Docker daemon or host kernel. Containers still share the host kernel and the image set. This is not a multi-tenant hosting claim.

## Alternatives considered

- **One shared runtime that routes by project:** rejected. Checkpoints, mailboxes and in-process state would be shared, and a runtime compromise would reach every project.
- **Docker socket in Fastify or in a runtime:** rejected. Equivalent to host root for any caller that can reach the API.
- **Per-project image builds:** rejected. Repeats tool installation and multiplies storage without an isolation gain, since images are read-only layers.
- **Kubernetes or multi-host scheduling:** rejected for now. Out of scope for a single-host deployment, and it adds a control plane that this design does not need.
