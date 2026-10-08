# ADR-0042: Require a mounted engagement workspace for evidence runs

- **Status:** Proposed
- **Date:** 2026-10-07
- **Related:** ADR-0040; `docs/design/2026-10-07-run-isolation-reproducibility-plan.md`

## Context

The launcher already mounts one engagement directory at `/workspace`. A cwd
prefix check cannot isolate arbitrary bash: an allowed cwd can still read
absolute paths into a shared mount. Adding a slug to the launcher's runtime
path also hides existing `/workspace/plan` files behind a second directory.

The review reproduced both failures with the current daemon and Linux mounts.
Objective metadata likewise needs a declared graph channel and a child-local
state copy; stamping a completed task cannot attribute that task's earlier work.

## Decision

- A pinned single-engagement mount uses `/workspace` as its runtime root.
  Compose derives `RAPTIX_WORKSPACE_ISOLATED=1` from the operator's explicit
  `RAPTIX_ENGAGEMENT_WORKSPACE` bind source. It is never accepted from tool input.
- When an engagement is pinned, the daemon refuses execution/file/session
  operations on an unisolated stack. Workspace-taking routes validate paths
  before touching the backend. Legacy unpinned dev mode keeps its existing API.
- The lab harness verifies both containers' engagement, isolation declaration,
  matching bind source and engagement-directory basename before starting a run.
  It refuses shared-root stacks, including when `--allow-dirty` is supplied.
- Keep the legacy `workspace_data` declaration for existing unpinned dev
  configurations. The user's `RAPTIX_WORKSPACE_PATH=workspace_data` is an
  indirect Compose reference, so deleting the declaration breaks rendering
  and disconnects existing data. This volume is not an evidence-run mount:
  the harness requires an engagement-specific bind, not a named volume.
- The scalar `active_objective_id` channel is a parent's last-joined cursor.
  Each dispatch supplies its validated objective to a separate child state
  before invocation; parallel children never borrow the parent's cursor.

## Threat model

The operator controls Compose and container environment; model/tool input does
not. Arbitrary bash remains root within its container and may read its whole
filesystem. Other engagements' persisted data must therefore not be mounted
there. The harness checks the actual Docker mounts, rather than trusting a cwd
or client-supplied flag. Docker socket/host mounts, privileged-container access
and operator-forged deployment declarations are outside the agent trust boundary.
No capabilities, network guardrails, RoE checks or approval slots are relaxed.
Restoring the legacy volume alias does not bypass mount verification or permit
named shared-root evidence runs; it preserves the unpinned dev migration path.

## Consequences

- **Easier:** launcher plans, CLI, daemon and capture use the same directory.
- **Harder:** evidence runs require a correctly pinned stack before invocation.
- **Migration:** shared-root lab stacks must be recreated with
  `RAPTIX_ENGAGEMENT=<slug>` and
  `RAPTIX_ENGAGEMENT_WORKSPACE=<absolute host workspace>/<slug>`; harness
  `--container-workspace` is `/workspace`.
- **Given up:** cwd-prefix fencing is no longer presented as filesystem isolation.

## Alternatives considered

- Parse bash strings for forbidden paths: rejected because shell expansion,
  interpreters and interactive sessions bypass string checks.
- Add per-call mount namespaces or new per-engagement containers: rejected for
  this correction because the existing launcher mount already provides the
  required boundary without additional privileges or lifecycle machinery.
