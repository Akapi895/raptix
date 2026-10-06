# Container View

Raptix deploys as a set of containers orchestrated via Docker Compose.

## Containers

| Container | Image | Role |
|-----------|-------|------|
| `raptix` | `infra/containers/Dockerfile` | LangGraph runtime — agents, middleware, tools |
| `neo4j` | Official Neo4j | Knowledge graph store |
| `sandbox` | `execution/sandbox/` | Isolated tool execution environment |
| `web` | `apps/web/` | Next.js dashboard |
| `telemetry-gateway` | `infra/telemetry-gateway/` | OpenTelemetry collector |

## Compose files

- `docker-compose.yml` — base service definitions
- `docker-compose.dev.yml` — development overrides (hot reload, debug ports)
- `docker-compose.watch.yml` — file-watch rebuild triggers

## Configuration

LLM provider OAuth handlers live in `infra/config/` — deliberately outside the runtime package. They are container-mount artifacts with zero `raptix` dependency (ADR-0039).

Environment variables:
- `BENCHMARK_MODE=1` — activates CTF/benchmark challenge injection
- `RAPTIX_ALLOW_SAFETY_OVERRIDES=1` — required to override safety-critical middleware slots
- `RAPTIX_LANGUAGE` — default output language (ISO 639-1)
