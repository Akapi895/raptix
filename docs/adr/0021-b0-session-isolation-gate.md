# 0021. Gate surface-exploit fan-out on session isolation

- **Status:** Proposed
- **Date:** 2026-09-30
- **Deciders:** Raptix maintainers
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
target, and do not automate it as part of the unit suite or regular CI.

1. Start the authorized isolated testbed with `make dev`. The gate does not
   need a full application exercise: it uses two bounded, local shell probes.
2. Execute the marked `slow` and `manual` integration harness with
   `RAPTIX_B0_LIVE=1` and `SANDBOX_URL` set to that stack's sandbox daemon:
   `packages/raptix/tests/integration/test_b0_session_isolation_live.py`.
   It invokes the real `raptix.tools.bash.bash.ainvoke` path twice via
   `asyncio.gather`, using `se-b0-a` and `se-b0-b` against the same real
   sandbox. This is the bash path that specialist `task()` calls use, without
   requiring the production orchestrator to emit parallel tasks.
3. Each coroutine creates `/workspace/se/b0-a/` or `/workspace/se/b0-b/`,
   changes to that workdir, records sandbox-side start/end timestamps around a
   short sleep in its marker file, and returns the marker. It makes no web
   request, scan, payload attempt, or target-state change.
4. Preserve the `B0_EVIDENCE=` JSON emitted by the harness. It contains the
   timestamp interval, marker paths, and pane-log status.
5. Mark **go** only when all conditions hold:
   - the two sandbox-side wall-clock intervals overlap, showing real parallel
     work;
   - neither session wedges, times out, or requires cross-session recovery;
   - each session has its own workdir and marker file, and its marker contains
     only that cell's identity and cwd;
   - neither tool result contains `[STALE]`, `[TIMEOUT]`, or `[ERROR]`.
6. Pane logs at `.sessions/<session>.log` are supporting audit and
   observability evidence, not an isolation precondition. When they are
   present, a cross-session value or `[STALE]` in a log is **no-go**. When they
   are absent, record `session_log="absent"` in `B0_EVIDENCE` as a separate
   audit/observability finding; absence alone is not **no-go**.
7. Mark **no-go** on an overlap failure, tmux wedge, shared marker/workdir,
   cross-session marker state, tool-result `[STALE]`/timeout/error, a leaked
   pane log when available, or ambiguous timing. Preserve available evidence,
   stop the test sessions, and do not enable B6 fan-out.

The production `decepticon` prompt retains its one-`surface_exploit`-task-per-
turn rule while this gate runs. Only a later PR, after a recorded **go** result,
may propose changing that dispatch rule; this ADR does not add a bypass flag or
modify production task dispatch.

## Pane-log Observability Finding

The B0 harness runs with the default workspace `/workspace`. In
`TmuxSessionManager.initialize()`, `_setup_pipe_pane_logging()` is called only
when a newly created session uses a workspace other than `/workspace`. The
default-workspace condition therefore skips pipe-pane setup before its
best-effort `try`/`except` can run. This is a daemon observability defect for
the default HTTP sandbox path: it removes audit logs and passive-read progress
visibility for long-running commands, but it does not change session manager,
workdir, marker, or stale-read isolation. Track and remediate it separately;
it is not a B0 isolation blocker.

## Recorded B0 Isolation Result

**Verdict: GO.** The manual harness completed on the isolated `raptix-b0`
sandbox with run ID `0bd0aa134010448187a0cc271c1df5af`.

- `se-b0-a`: `/workspace/se/b0-a/marker-0bd0aa134010448187a0cc271c1df5af.json`
  recorded `[1790772733414531246, 1790772734417591564]` ns.
- `se-b0-b`: `/workspace/se/b0-b/marker-0bd0aa134010448187a0cc271c1df5af.json`
  recorded `[1790772733414555373, 1790772734417594616]` ns.
- The overlapping interval was
  `[1790772733414555373, 1790772734417591564]` ns. Both markers carried only
  their own session and `/workspace/se/b0-*` cwd, and the harness reported no
  timeout, stale, error, or cross-marker state.
- `B0_EVIDENCE` recorded both pane logs as `session_log="absent"`; this is the
  separate observability finding above, not an isolation failure.

## Alternatives considered

- **Run live tmux in CI:** rejected because it requires Docker, a sandbox, and
  an authorized target, making it non-deterministic and unsafe for unit CI.
- **Proceed directly to B6 after the fake test:** rejected because the fake
  verifies the key contract but not real scheduling or tmux behavior.
