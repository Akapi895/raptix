# Dedicated Web execution plane with sandbox-parity hardening

**Status: Proposed** — 2026-10-16

## Context

M1 puts the mock-proven UX on real runs. Reusing the CLI stack's runtime and
sandbox would couple browser-triggered runs to CLI engagement state, share the
CLI workspace bind mount (concurrent writers make consistent workspace
snapshots impossible), and inherit CLI runtime restarts. The O02 verification
showed the Web API needs its own workspace root, slug and sandbox endpoint to
make storage round-trips and backup/restore verifiable end to end.

## Decision

`docker-compose.web-runtime.yml` layers a dedicated execution plane onto the
Web deployment: `web-runtime` (LangGraph dev server with the same
`LANGGRAPH_STRICT_ASYNC` guard) and `web-sandbox` on named volumes
(`web_runtime_workspace`, `web_runtime_state`), joined to the existing
`sandbox-net` so the management network never reaches the sandbox. The Web API
points `LANGGRAPH_API_URL`, `RAPTIX_RUNTIME_SANDBOX_URL` and
`RAPTIX_RUNTIME_WORKSPACE_SLUG` at this plane; CLI compose files and volumes
are untouched. A dedicated slug (`WEB_RUNTIME_SLUG`) namespaces `/workspace`
inside both containers.

Because `web-runtime` is dual-homed (management + sandbox-net) and executes
agent code, it carries the same container posture as the sandbox it drives:
`cap_drop: [ALL]` with a minimal `cap_add` set, `no-new-privileges`, memory
and pid limits, and `init: true`. It mounts no docker socket; sandbox
execution stays HTTP-only. `tests/test_compose_network_isolation.py` pins the
command guard, networks, mounts and hardening.

## Consequences

Workspace backups snapshot `WORKSPACE_PATH/<slug>` (the dedicated volume) —
not the parent bind mount, which also exposes the CLI stack's workspace and
may be written to while a snapshot is read. Runtime state survives container
recreation via `web_runtime_state`. The CLI stack keeps its own runtime and
sandbox; bringing a Web engagement to the CLI plane remains an explicit
future migration, not an implicit shared mount.
