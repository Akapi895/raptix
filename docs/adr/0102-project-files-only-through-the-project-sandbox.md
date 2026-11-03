# ADR-0102: A project's files are reachable only through its own sandbox, and RoE and abort fail closed

- **Status:** Accepted — owner decision 2026-10-25. The repository owner approved this design in the session on 2026-10-25 and chose not to migrate the seven existing projects. Maintainer acceptance in writing is still pending.
- **Date:** 2026-10-25
- **Deciders:** repository owner (approved in session); maintainer acceptance pending
- **Related:** ADR-0086 (per-project sandboxes; this ADR supersedes its shared-volume subpath mount and its per-run `/workspace/<slug>` path), ADR-0092 (managed environments; not active in this deployment, unchanged), ADR-0101. Guard rails touched: RoE enforcement (`middleware/roe.py`), the emergency `.abort` marker, and the sandbox container hardening in `docker-compose.web-runtime.yml`.

## Context

Under ADR-0086 each project has its own sandbox container, but the containers mount a subpath of one shared volume at `/workspace/<slug>`. The web API and the LangGraph runtime mount the whole volume at `/workspace`. Two consequences follow. First, the runtime process, which runs the agent and enforces RoE, can read and write every project's directory. Second, the agent's own view of its working directory contains a project slug, so the path the LLM sees includes `/workspace/<slug>/`.

The runtime reads `plan/roe.json` and the `.abort` marker directly from the filesystem, and `middleware/roe.py` treats an unreadable RoE document as audit-only mode. Removing the volume mount without changing that path would therefore turn RoE enforcement fail-open and disable the emergency stop. That is why this ADR changes the storage layout and the read path together.

The LangGraph API on port 2024 accepts unauthenticated requests and shares `raptix_web_sandbox-net` with the sandboxes. A command inside one project's sandbox could list the threads of another project. The sandbox also receives the whole deployment `.env` through `env_file`, including provider keys and the admin password, and `kernel/tmux.py` copies that environment into the agent's shell. The Neo4j host is not reachable from a sandbox in this deployment, so the Neo4j password in the sandbox serves no purpose.

## Decision

1. **One volume per project.** Each project sandbox mounts its own named volume `raptix-ws-<slug>` at `/workspace`. There is no subpath and no path that contains a slug. The launcher creates the volume with the sandbox's compose file. The plan directory `plan/` is created inside the container.
2. **Files go through the sandbox.** The web API and the runtime read and write project files only through the project's sandbox daemon, using `/download_files`, `/upload_files`, and `/execute`. The web API uses the project token it derives from the sandbox key. The runtime uses the `sandbox_token` carried by each run. Neither mounts any project volume. The shared volume `raptix-web-raptix_web_runtime_workspace` is no longer mounted by any service.
3. **RoE fails closed on read failure.** `roe.json` is read through the run's sandbox. If the sandbox cannot be reached, or the document exists but cannot be read or parsed, every gated tool call is refused with an explicit `ROE_UNAVAILABLE` message. The runtime never falls back to audit-only mode for these cases. A missing `roe.json` keeps its current meaning, "no RoE document, machine enforcement off", because a project has no RoE before planning. This is stated as an explicit choice in this ADR; see Consequences.
4. **The abort marker is read through the sandbox, and an unreachable sandbox counts as aborted.** The operator's emergency stop writes `/workspace/.abort` through the sandbox. The runtime checks it through the sandbox before every gated tool call. If the sandbox cannot be reached, the call is refused with the existing `AGENT_HALTED` message.
5. **The agent sees only `/workspace`.** The configurable `workspace_path` sent to the runtime for every project is `/workspace`. The daemon's engagement pin, which hard-codes `/workspace/{slug}`, is removed from the sandbox environment, because the mount is now the boundary.
6. **Runtime API authentication.** The LangGraph API requires a bearer token of every caller (`interfaces/api/auth.py`, `langgraph.json` `auth`). The token lives in the file `runtime-api-token` in the secrets directory and is mounted read-only into the web API and the runtime only. Routes served by the custom `plugins_api` app also require it. A runtime without the token refuses every request.
7. **Sandbox environment is an allowlist.** The sandbox compose file no longer passes `env_file`. It sets `SANDBOX_DAEMON`, `SANDBOX_TOKEN`, and nothing else from the deployment. `NEO4J_*` is removed, because the Neo4j host is not reachable from a sandbox.
8. **No migration of existing projects.** The seven projects in the `Engagement` table are deleted with their data. The owner decided this on 2026-10-25. The shared volume is retired. Its deletion needs the owner's separate confirmation, because it also holds directories that are not in the database.
9. **The database stops storing a workspace path.** The `Engagement.workspacePath` column is dropped in a migration, and no code writes or reads it.

Accepted as public by the owner: `/ok`, `/info` (version and feature flags), `/docs`, and `/openapi.json` (the route schema). They expose no project data.

## Consequences

- **Easier:** A project's data is reachable only from its own container. A compromised command in one sandbox cannot read another project's files or list its threads. The sandbox environment cannot leak deployment keys.
- **Harder:** Every planning-document read, every artifact write, and every RoE check now calls a sandbox. A stopped sandbox therefore stops planning-document reads, artifact writes, and gated tool calls. This is intended: a project that is not running cannot be governed.
- **Given up:** The runtime can no longer read a project's files when its sandbox is down, and the Neo4j password in the sandbox is gone. The seven existing projects and their data are deleted, not migrated.
- **Explicit choice to confirm:** a missing `roe.json` remains audit-only. If the owner wants it to fail closed too, that is a one-line change to the RoE reader and a new decision.
- **Migration:** The owner chose deletion. Steps: delete the seven projects, drop `workspacePath`, redeploy the API and the runtime with the new compose files, and recreate sandboxes with the new template. `raptix web sandboxes sync` and the shared-volume orphan removal are retired.

### Threat model

- **Assets:** project files and planning documents; RoE enforcement and the abort marker; the runtime API token; the sandbox key that derives project tokens; deployment secrets in `.env`.
- **Cross-project file read or write through a sandbox:** blocked by the per-project volume and by the token each sandbox daemon checks. The sandbox has no path to another project's volume.
- **Cross-project file read or thread listing through the runtime API:** blocked by the runtime token. A sandbox never holds it.
- **RoE bypass by making its document unreadable or the sandbox unreachable:** blocked, because both fail closed.
- **Abort bypass by making the sandbox unreachable:** blocked, because an unreachable sandbox counts as aborted.
- **Deployment secrets read from a sandbox:** blocked by the environment allowlist.
- **Residual risks:**
  - The runtime is trusted code. It holds the runtime token and each run's sandbox token. Both are stored in LangGraph run configuration in the runtime's state volume, so anyone who can read that volume can use them.
  - `/info`, `/docs`, and `/openapi.json` stay public. The owner accepted this.
  - A sandbox can still reach the public internet and the runtime's `/ok` route on `raptix_web_sandbox-net`.
  - The web API holds the sandbox key. It is the only holder besides the launcher.
  - The web API is on `raptix_web_sandbox-net` to reach the sandboxes, so a sandbox can send it requests. Its project routes need a login (multi-user mode); `/api/health` and `/api/capabilities` are public.

## Alternatives considered

- **Keep one shared volume and mount per-project subpaths in the sandboxes, while the runtime keeps the whole volume.** Rejected: the runtime still reads every project directory, and the agent still sees `/workspace/<slug>`.
- **Run one runtime container per project (ADR-0092).** Rejected for now: it multiplies runtime memory and is not needed to close the cross-project read path, which the token and the per-project volume close.
- **Split the networks so sandboxes cannot reach the runtime.** Rejected: the runtime must reach the sandboxes, and Docker cannot filter one direction of a shared network per port.
- **Change the LangGraph port from 2024.** Rejected: a port is not an access control. A sandbox can reach any port on the shared network.
- **Put a token-checking reverse proxy in front of LangGraph.** Rejected: custom auth is in-process, covers the streaming routes, and needs no extra hop.
- **Migrate the seven projects.** Rejected by the owner, who chose deletion.
