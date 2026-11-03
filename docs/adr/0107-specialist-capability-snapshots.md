# Specialist capability snapshots

Status: Proposed

Specialist additions are Web business configuration, persisted in the existing
Prisma AppConfig store. The BFF snapshots global plus project additions into
each new run's configurable data. The runtime validates stable catalog IDs and
assembles a fresh graph, including delegated specialists, from that immutable
snapshot. Existing factories, prompts, middleware ordering and authorization
remain authoritative. Configuration is additive only.

Use optimistic compare-and-set on one versioned configuration document so
inheritance is read atomically and concurrent saves cannot lose updates.
An unavailable requested capability fails construction before model execution;
there is no reduced-capability fallback. Run metadata and checkpoint state
retain configuration identity and loaded-capability evidence.

## Threat model

Configuration accepts registered IDs, never Python imports, commands, MCP URLs
or credentials. MCP connections come only from operator-managed runtime env.
Namespaced MCP tools retain their remote tool name for execution and pass
through the specialist's existing tool middleware. Availability is not
authorization. Additional capabilities cannot replace built-ins or middleware.
Runtime credentials stay in the BFF. Project snapshots are copied per run and
assembly context is task-local, never a process-global project setting.

The change spans multiple review-sized concerns (storage/contracts, runtime,
API, UI, verification); this working tree is not a single merge-ready PR.
