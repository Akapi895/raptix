# 0086. Per-run workspace isolation replaces the single-engagement sandbox pin

- **Status:** Proposed — revision required (review finding below)
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

## Review finding (2026-10-17): the per-request fence does not isolate bash

The decision above assumes the sandbox kernel can confine a run to its subtree
by checking `workspace_path` per request. That does not hold for the agent's
shell. The web sandbox mounts the whole volume at `/workspace`
(`docker-compose.web-runtime.yml`), and bash runs commands under that mount. A
prefix check on the requested path does not stop `cat /workspace/<other>/…` or
`cd ..` inside a run. The kernel already records this limit in
`kernel/base.py` (`engagement_fence_error` docstring: "A prefix check alone
cannot restrict what arbitrary bash can read").

So per-request fencing alone cannot provide the isolation this ADR was
accepted for. Options that do provide a real boundary, each needing a decision:

- **A. One sandbox container per project**, each mounting only its own
  directory. Real isolation; costs one container per project and a launcher
  change. This is the alternative the first draft rejected for resource use.
- **B. Single engagement per deployment** (revert `f4c7a00`). Real isolation;
  blocks running several projects on one deployment.
- **C. Keep one shared sandbox with per-request fences and accept the risk.**
  Not recommended: the fence does not stop cross-project reads, so this
  would present as isolation when it is not.

Until one of A/B is chosen, the deployment should be treated as having no
isolation between projects.

