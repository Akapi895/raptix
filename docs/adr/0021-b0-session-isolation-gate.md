# 0021. Gate surface-exploit fan-out on session isolation

- **Status:** Proposed
- **Date:** 2026-09-30
- **Deciders:** Decepticon maintainers
- **Related:** `summary/impl-plan-surface-exploit.md`, `docs/adr/0020-coverage-matrix-objectives.md`

## Context

The B5 coverage matrix gives each `(vuln_class, surface)` cell a deterministic
`session_name`. B6 may later issue multiple `surface_exploit` tasks in one
turn, but parallel tasks share a sandbox and must not share shell state. The
bash contract scopes tmux managers, workspaces, background jobs, log offsets,
and stale-read tracking by `(workspace_path, session)`.

An automated unit test can verify that contract without Docker, tmux, a live
engagement, a target, or an LLM. It cannot prove that two real task calls
overlap in wall-clock time, so that evidence remains a manual testbed gate.

## Decision

Add deterministic fake-sandbox T0 coverage for two distinct sessions and for
reusing one session. The test asserts independent workdir, history, files, and
stale-read state, while same-session calls retain state. Add a separate B5
assertion that different vulnerability classes on one surface receive distinct
session names.

Use the runbook below for the manual go/no-go check before B6. The runbook
must use two distinct session names and output directories. This ADR changes no
bash behavior, exploit path, dispatch logic, or guardrail.

## Consequences

- **Easier:** session collisions become a deterministic unit-test failure, and
  the live evidence requirements are explicit before bounded fan-out.
- **Harder:** B6 remains blocked until the manual testbed run demonstrates real
  overlap and clean separation.
- **Given up:** the unit suite does not claim to prove live tmux scheduling or
  model/tool parallelism.

## B0 Runbook: manual testbed gate

This is a manual confirmation step. Do not run it against an unauthorized
target, and do not automate it as part of the unit suite.

1. Start the authorized isolated testbed with `make dev` and select one
   reachable web target covered by the engagement RoE.
2. Complete engagement startup and operator approval. Run B5 so the OPPLAN
   contains two pending cells for the same target surface, each with a
   different `session_name` such as `se-<cell-a>` and `se-<cell-b>`.
3. In one orchestrator turn, issue two `task("surface_exploit", ...)` calls.
   Include the target surface, one vuln class, its own `session_name`, and a
   role-prefixed output directory such as
   `/workspace/se/<cell-a>/` and `/workspace/se/<cell-b>/`. Do not reuse either
   session name or output directory.
4. In each specialist task, use a bounded harmless probe on the authorized
   web target and write a distinct marker file under that cell's output
   directory. Observe the two task start/completion timestamps, sandbox
   session status, `.sessions/<session>.log` files, and marker files.
5. Mark **go** only when all conditions hold:
   - the two task wall-clock intervals overlap, showing real parallel work;
   - neither session wedges, times out, or requires cross-session recovery;
   - each session has its own tmux/log/workdir state and marker file;
   - neither log, history, cwd, output, nor `[STALE]` signal appears in the
     other cell's session.
6. Mark **no-go** on any overlap failure, tmux wedge, shared file/log/history,
   cross-session `[STALE]`, or ambiguous timing. Preserve logs, stop the test
   sessions, and do not enable B6 fan-out.

## Alternatives considered

- **Run live tmux in CI:** rejected because it requires Docker, a sandbox, and
  an authorized target, making it non-deterministic and unsafe for unit CI.
- **Proceed directly to B6 after the fake test:** rejected because the fake
  verifies the key contract but not real scheduling or tmux behavior.
