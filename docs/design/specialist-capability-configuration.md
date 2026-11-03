# Specialist Configuration & Capability Extension

Implementation decision: [ADR-0107](../adr/0107-specialist-capability-snapshots.md)
(Proposed). This is a multi-concern working tree, to be split into review-sized
contributions before submission. No production deployment is part of this work.

## Configuration and storage

A specialist is an installed runtime factory, distinct from a custom persona and
from an operator role. Its default prompt, behavior, tools, skills, middleware,
model selection and execution policies continue to come from that factory.
Selections only add capabilities; they never replace factory inputs.

The effective set is the union of built-ins, global additions and additions for
the run's project. IDs are deduplicated and sorted. A project reset removes only
that project's additions. A global reset leaves project additions untouched.

The existing Prisma `AppConfig` table stores one JSON document under
`specialist-capabilities-v1`; **no migration is required**:

```json
{
  "revision": 3,
  "scopes": {
    "global": {
      "recon": {"revision": 1, "skills": [], "tools": ["tool:solidity_scan"], "mcp": []}
    },
    "project:PROJECT_ID": {
      "recon": {"revision": 3, "skills": ["/skills/standard/analyst/sql-injection/SKILL.md"], "tools": [], "mcp": ["mcp:controlled:echo_marker"]}
    }
  }
}
```

Saving uses an atomic compare-and-set against the previous JSON value. The
document revision is the optimistic concurrency token and increments on every
successful save/reset. Each scope/specialist also retains its last revision.
Concurrent saves cannot overwrite another save. A stale revision returns 409.
Prisma/PostgreSQL provides restart persistence; no browser storage is authoritative.
Project IDs are checked against existing business records on read/write.
Selections for deleted projects cannot be reused for a different project ID.

## Runtime catalogs

- Specialists: enabled `raptix.subagents` factories, plus the built-in standalone
  planner/bootstrap factories. The Web listing continues to use the live
  LangGraph graph registry. Unknown external graphs can be listed, but their
  configuration is rejected unless they participate in shared factory assembly.
- Tools: actual `BaseTool` objects from exported runtime tool groups, web search
  tools, and role-scoped plugin contributions. IDs are `tool:<registered-name>`.
  Plain offline functions and operator-control tools are not fabricated into
  selectable tools. Conflicting registered names are rejected.
- Skills: the installed `raptix-skills` corpus's discovered `SKILL.md` records.
  The canonical virtual path is the existing stable skill ID. A selection adds
  the skill package directory (including references/subskills) to the existing
  role allowlist. Both legacy SkillsMiddleware and Skillogy receive this source
  set, and the actual `load_skill` tool uses it. Corpus knowledge does not imply
  that binaries mentioned in a skill are installed.
- MCP: operator-managed `RAPTIX_MCP__SERVERS` connections, discovered using
  `load_mcp_tools(strict=True)`. The unrelated Web external-MCP business store is
  not represented as a live runtime connection. Configure the runtime first;
  this feature does not install servers or execute commands supplied by a Web
  configuration request.

MCP IDs are `mcp:<percent-encoded-server-name>:<percent-encoded-tool-name>`.
Only selected IDs are attached. Runtime tool names use a deterministic hash of
the full ID to prevent server/name collisions. Tool metadata retains the original
name for existing HITL and RoE policy matching; namespacing cannot evade those
existing name-based rules. Tool invocation still traverses the factory's normal
middleware. Scope and approval remain invocation decisions. As with existing
runtime policy, audit-mode RoE is audit-only and HITL assembly is opt-in.

Catalog fields distinguish package installation, runtime connection
configuration, reachability and selectable availability. Tool
`execution_readiness=invocation_checked` means a registered callable can be
loaded; it does not claim that a remote sandbox binary/service is healthy.
Skill requirements are reported as knowledge/execution prerequisites, not as
proof of tool installation. Per-target eligibility and authorization are not
catalog flags.

MCP discovery is bounded to 12 seconds per server (concurrently). Tool calls are
bounded to 30 seconds. The official adapter opens scoped sessions for discovery
and individual invocations, including subprocess cleanup on cancellation; no
live client or open connection is stored in project configuration or a graph
cache. Connection/credential errors are summarized without returning raw URLs,
headers, commands, tokens or exception strings to the browser.

## Execution lifecycle

The BFF reads an atomic configuration snapshot for every new chat or batch run.
Streaming chat honors the conversation's specialist ID, as non-streaming chat
does. The snapshot is included in `configurable.specialist_configuration` and
run metadata. Its schema is `ConfigurationSnapshot` in the Python runtime and
`SpecialistSnapshot` in `@raptix/web-contracts`.

`langgraph.json` and `graph_registry.py` register **graph factories**, not static
compiled toolsets. Each invocation calls `configured_graphs.assemble_graph`:

1. Parse the snapshot and identify the direct specialist or delegated roster.
2. Resolve registered tool objects, current skill records and selected MCP tools.
3. Reject unknown/unavailable requested capabilities before model execution.
4. Enter a task-local `ContextVar` for synchronous factory assembly.
5. Call the existing specialist/orchestrator factory. `build_tools` appends tools
   after preserving the built-in exposure pipeline. `build_middleware` extends
   skill sources while preserving middleware order and factory policies.
6. The orchestrator's existing `spec.factory()` calls observe the same immutable
   assembly context, so `task()` uses the same additions as direct execution.
7. Reset the context in `finally`. No project configuration is installed in a
   process-global tool registry. A fresh graph is returned for the run.

Autohunt keeps its Soundwave behavior/model/slots while mapping its additions to
its own identity. `raptix-delta` retains `DeltaDispatchState` and its delta channel.
Library callers using existing factories retain their previous default behavior.
Runtime-token callers outside the BFF must supply a snapshot explicitly if they
want Web-saved additions; the Python runtime does not import Prisma or read the
Web database.

Checkpoint state `specialist_configuration` is a role-keyed map of loaded
evidence: document revision, project ID, global/project revisions, requested
selections, actual tool names and skill sources. A merging channel prevents child
state from overwriting parent evidence. Orchestrator evidence also records its
assembled specialist roster. Assembly means capabilities are loaded, not that
the model invoked them or that an objective succeeded.

Policy: **fail closed on invalid requested configuration**. No requested MCP
server failure, unknown tool or missing skill is silently skipped. Existing
executions keep their own graph and snapshot when configuration is saved again.
An already admitted run also keeps the snapshot it was created with while queued.

## Browser interface

The frontend is the existing DOM/TypeScript app; no React runtime is introduced.
`features/roles/specialist-manager.ts` implements a searchable specialist list
and a configuration editor with Overview, Skills, Tools and MCP tabs. Global
and project contexts are explicit. Built-ins and inherited global selections
are read-only. MCP tools are selected individually beneath native expandable
server headings. Unknown saved additions remain removable after disconnection.

Save validates, persists and reports a revision; it never labels stored IDs as
active in a running agent. Cancel restores saved edits. Reset clears this scope's
draft and requires Save. Errors name the recovery path, stale saves retain the
draft, and project changes/away-navigation warn about unsaved work. Loading
disables controls to avoid racing a selection with a scope change. Request epochs
prevent an old response from replacing a different specialist/project editor.

Impeccable Operate guidance: preserve light surfaces, red selection/action accent
and existing typography; use compact native controls, a flat split layout,
restrained status labels, disclosure for long built-in lists and contextual help.
The custom-persona editor remains a separate, labeled section. Tabs use standard
roles, selected states, roving focus and Arrow/Home/End keys. The list stacks
above the editor on mobile. Focus, errors and empty/disconnected states are
included rather than relying only on color.

## HTTP contract

See [the complete specialist OpenAPI schema](../api/specialists.openapi.yaml).
All browser endpoints require the existing operator session. The BFF alone holds
the runtime token. The new runtime routes are mounted beneath the authenticated
custom runtime app at `/_raptix/specialists`.

| Operation | Browser endpoint |
|---|---|
| Live specialist list | `GET /api/specialists` |
| Built-ins and selectable catalogs | `GET /api/specialists/{id}/catalog` |
| Saved/global/project/effective/resolved sets and diagnostics | `GET /api/specialists/{id}/configuration[?project_id=ID]` |
| Save additions or reset with three empty arrays | `PUT /api/specialists/{id}/configuration[?project_id=ID]` |

Omitting `project_id` edits global scope. `effective` is the union of additions;
`resolved` includes built-in IDs too. Invalid IDs, malformed payloads and duplicate
selections return 400, invalid project references return 404, stale revisions
return 409, and unavailable runtime transport returns 503. Runtime preflight
returns 422 for invalid capability selections (translated to 400 by the BFF).

## Verification

Focused runtime tests use actual compiled Recon and orchestrator graphs, normal
factory middleware, a controlled model provider and a local stdio FastMCP server.
They call real `load_skill`, `solidity_scan` and the selected MCP tool through
both direct execution and `task()`, with assertions on returned tool content.
The MCP peer also exposes an unselected tool to check selective loading.
Lifecycle coverage holds one model call open while another revision is assembled
and confirms that old/new/project-B toolsets and evidence remain isolated.

Fastify tests cover authenticated saves, validation, reset, inheritance,
snapshot propagation and rebuilding the backend. The opt-in PostgreSQL check
closes all Prisma connections, opens a fresh client and verifies persistence and
CAS races against a disposable migrated database:

```powershell
$env:SPECIALIST_TEST_DATABASE_URL='postgresql://.../disposable_database'
node --import tsx tests/integration/specialist-persistence.check.ts
```

Browser tests exercise save/reload, inherited disabled selections, reset/cancel,
keyboard tabs and 375/768/1440px layouts. Demo fixture tests establish browser
interaction behavior; the runtime integration tests establish actual execution
wiring. No live external target is required.

Observed results for the disposable verification stack: 44 focused Python tests
(specialist assembly plus existing dispatch/mailbox boundaries) passed; the
PostgreSQL persistence check passed; the production Docker images built; the
production browser check saved and reloaded `tool:cve_lookup`, rendered at
375/768/1440px and completed a new Recon run; the HTTP acceptance check passed
for direct execution, orchestrator `task()` delegation, real skill/tool/MCP
calls, Project B isolation and persistence after restarting the actual API
container. The runtime server ran with the event-loop blockbuster guard enabled;
its dispatch/mailbox SQLite ledger is now accessed through worker threads.

Limits: remote MCP tools execute in their server's environment; this feature does
not provision that environment or assert sandbox egress enforcement over it.
Remote tool semantics must fit the existing invocation policy. External plugin
factories that bypass the shared builders cannot receive additions and are
rejected explicitly. A selected skill package can include nested subskills. Saved
configuration applies at run creation; mid-run hot mutation is intentionally absent.
