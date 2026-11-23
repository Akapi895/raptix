# Web integration

`apps/ui-app` is the Web console. `apps/api` translates its HTTP contract to the Python runtime and owns the project records needed by the console. The former `apps/web` app was retired on 2026-10-31. [Frontend contract](../../apps/ui-app/docs/openapi.yaml) · [API registration](../../apps/api/src/app.ts)

## Service and data boundaries

| Layer | Responsibility |
| --- | --- |
| Browser | Project navigation, conversations, findings and evidence views. The demo transport uses local fixtures for UI development. |
| Web API | Session checks, project routing and business records in PostgreSQL, including conversation associations, findings and Vault records. |
| Python runtime | Thread and run state in LangGraph checkpoints. The Web API authenticates to the runtime on the server side. |
| Workspace and Neo4j | The project sandbox owns workspace artifacts. Neo4j owns graph observations. PostgreSQL owns reviewed findings and their retained evidence snapshots. |

The Web API keeps the runtime credential on the server. The browser uses its Web session. The runtime and the sandbox controller check their own credentials. [Runtime client](../../apps/api/src/adapters/runtime/client.ts) · [Runtime auth](../../packages/raptix/raptix/interfaces/api/auth.py) · [Graph and evidence ownership](knowledge-graph-design.md)

## Supported routes and deployment dependencies

| Area | Status in the checkout | Source |
| --- | --- | --- |
| Projects and conversations | Implemented. Project and conversation records are associated with runtime threads. Thread and run operations require a reachable runtime. | [Projects](../../apps/api/src/http/routes/projects.routes.ts) · [Conversations](../../apps/api/src/http/routes/conversations.routes.ts) |
| Chat and batch runs | Implemented through the runtime transport. Availability depends on deployment configuration. | [Agent loop](../../apps/api/src/http/routes/agent-loop.routes.ts) · [Batch tasks](../../apps/api/src/http/routes/batch-tasks.routes.ts) |
| Project files and approval | Implemented through the project sandbox. File access requires a provisioned sandbox. Approval also requires the runtime approval policy to be enabled. | [Files](../../apps/api/src/http/routes/files.routes.ts) · [Approval routes](../../apps/api/src/http/routes/hitl.routes.ts) |
| Findings and graph evidence | Implemented. The API scopes reads to the project and stores evidence and verification state in PostgreSQL. | [Fact promotion](../../apps/api/src/http/routes/fact-promotion.routes.ts) |
| Workflows | Workflow definitions have CRUD routes. Execution routes return `501`. | [Workflows](../../apps/api/src/http/routes/workflows.routes.ts) |

The OpenAPI inventory is the endpoint contract. Check route registration, the store or adapter, and the HTTP tests before treating an operation as supported. Retain the distinction between implemented routes, missing deployment dependencies, and explicit stubs.

## Verification

HTTP tests cover the route contract with test stores and transports. Compose defines the Web API and console services. Deployment checks should cover session enforcement, an unavailable dependency, and access to persisted records after restart. Record live checks separately from the results of demo and HTTP tests. [API tests](../../apps/api/tests/http/) · [Web setup](../../apps/ui-app/README.md) · [Compose](../../docker-compose.yml)

The migration plan with the original tier decisions is available as `docs/design/2026-10-31-ui-app-integration-implementation-plan.md` in Git at `8e5d356b`.
