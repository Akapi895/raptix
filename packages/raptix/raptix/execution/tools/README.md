# `raptix.tools` — tool catalog

Agent tools grouped by attack-surface / capability domain. This directory is
intentionally **flat** (one subpackage per domain) rather than nested: several
domains — notably `bash/`, `sandbox` dispatch and the C2 integrations — are
frozen paths under the project guardrails (see `AGENTS.md`), so they must keep
stable import paths and are never moved for cosmetic grouping.

## Domain groups

| Group | Purpose |
|---|---|
| `bash/` | **Frozen (guardrail).** Sandbox command execution. Do not restructure or weaken `SafeCommand`. |
| `web/` | Web application testing and HTTP tooling. |
| `browser/` | Headless browser-driven interaction. |
| `cloud/` | Cloud provider enumeration and testing. |
| `ad/` | Active Directory / identity tooling. |
| `reversing/` | Binary analysis and reverse engineering. |
| `defense/` | Blue-cell / defensive helpers. |
| `evidence/` | Evidence capture and handling. |
| `reporting/` | Findings and report generation. |
| `research/` | External research / knowledge lookups. |
| `references/` | Reference data and lookups. |
| `interaction/` | Human-in-the-loop interaction tools. |
| `proxy/` | Proxy / traffic interception helpers. |
| `ops/` | Operational / engagement utilities. |

## Framework plumbing (not attack-surface tools)

| Group | Purpose |
|---|---|
| `contracts/` | Tool contracts and shared type surface. |
| `mcp/` | MCP client/server tool bridging. |
| `plumbing/` | Agent-support tool modules with no single attack-surface domain (`filesystem`, `skills`/`skills_registry`, `verification`, `opplan`). Unrelated to each other — import from the specific submodule, not the package. |

## Conventions

- Tools register with the runtime via the plugin system; external plugins
  attach under the `raptix.tools` entry-point group.
- Keep one concern per tool module; shared helpers belong in the group's
  package, not spread across domains.
- Never widen a tool's blast radius (new network egress, new exec path) without
  the guardrail review that `AGENTS.md` requires.
