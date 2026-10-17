# 0086. Per-run workspace isolation replaces the single-engagement sandbox pin

- **Status:** Proposed
- **Date:** 2026-10-17
- **Deciders:** pending (project owner)
- **Related:** ADR-0082 (dedicated web execution plane), ADR-0085 (single-operator planning scope); commit `f4c7a00`

## Context

The web execution plane (`docker-compose.web-runtime.yml`) pinned its runtime
and sandbox to one engagement: `RAPTIX_ENGAGEMENT` and
`RAPTIX_WORKSPACE_ISOLATED=1`. The sandbox kernel then restricted every command
to that engagement's subtree (`execution/sandbox/kernel/base.py`, the
"allowed subtree" check), and `execution/tools/bash/bash.py` refused any other
slug. Only one project could run on a deployment.

Commit `f4c7a00` removes the pin so any project can run, and sets
`RAPTIX_WORKSPACE_ISOLATED=0`. That removes the per-engagement boundary for the
sandbox entirely: a run can address any directory under `/workspace`. The
boundary is now only as strong as the run's own `workspace_path` configuration.
This is a weakening of an isolation control and is not accepted until this ADR
is.

## Decision

Restore the boundary per run, not per container:

1. The server already sends `workspace_path` per run (`projects/<slug>`).
   The sandbox kernel derives the allowed subtree from each request's run
   configuration, not from `RAPTIX_ENGAGEMENT`, and rejects any path outside it.
2. `RAPTIX_WORKSPACE_ISOLATED` stays `1` on the execution plane. The engagement
   pin variables stay unset.
3. Until step 1 ships, the deployment must not expose one sandbox to projects
   that are not mutually trusted.

## Consequences

- **Easier:** any number of projects run on one execution plane, each confined
  to its own subtree.
- **Harder:** the kernel check moves from a process-level setting to a per-request
  check; it needs tests for path traversal across two projects.
- **Given up:** a single sandbox process serving one engagement with no per-request
  checks (the current, simpler model).
- **Migration:** deployments that already run one engagement keep working;
  the subtree is that engagement's slug.

## Alternatives considered

- **One sandbox container per project.** Rejected for now: one container per
  project multiplies resource use and the compose topology for every project.
- **Keep the pin and run one deployment per project.** Rejected: it is the
  limitation this change exists to remove.
- **Keep `RAPTIX_WORKSPACE_ISOLATED=0` and rely on the server's `workspace_path`
  alone.** Rejected: nothing in the sandbox enforces it, so one project's run
  could read another's files.
