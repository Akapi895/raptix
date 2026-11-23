# Raptix documentation

## Run the Web console

- [Web setup](../apps/ui-app/README.md) covers the local demo, Docker deployment and frontend checks.
- [Model settings](model-settings.md) explains provider selection and fallback. [MCP servers](mcp-servers.md) describes optional tool connections.

## Architecture

- [Runtime boundaries](architecture/runtime-boundaries.md) describes the repository layout and runtime services. [Dependency rules](architecture/dependency-rules.md) covers package boundaries.
- [Web integration](architecture/web-integration.md) traces requests from the console to the runtime. [Knowledge graph and evidence](architecture/knowledge-graph-design.md) describes where data is stored and how it is linked.
- [Tool ownership](architecture/tool-ownership.md) explains capability contracts and verification. [Skills](architecture/skills.md) covers retrieval and role visibility. [Skill schema](architecture/skill-schema.md) defines corpus metadata.

## Security

- [Threat model](security/threat-model.md), [security controls](security/security-controls.md) and [sandbox isolation](security/sandbox-isolation.md) describe the trust boundaries.
- [Scope enforcement](security/roe-machine-enforcement.md), [approval](security/hitl-approval.md) and [prompt-injection defense](security/prompt-injection-defense.md) describe execution controls.
- [Audit ledger](security/audit-ledger.md), [Blue Cell](security/blue-cell.md), [Neo4j hardening](security/neo4j-hardening.md) and [telemetry](security/telemetry.md) cover evidence, monitoring and data handling.
