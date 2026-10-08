# ADR-0045: Bind summarization offload to the engagement workspace

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0006; ADR-0042;
  `docs/context-optimization-implementation-plan.md` (WP-A2, defect C2);
  `benchmarks/Silentium/run-20261008-0642/analysis/CONTEXT_AUDIT.md` §1.2, §10

## Context

deepagents' summarization middleware offloads evicted history to
`"{artifacts_root}/conversation_history/{thread_id}.md"` and embeds that path
in the compaction summary so the agent can re-open it with `read_file`. The
prefix is fixed at construction from `backend.artifacts_root`; a bare
`CompositeBackend` defaults to `/`, so the file is written to
`/conversation_history/...`.

Raptix serves each engagement from a workspace-scoped
`EngagementFilesystemBackend` (`/workspace` → `/workspace/<engagement>`), and
ADR-0042 fences the sandbox to that workspace. The offload path never passed
through that mapping, so the summary pointed outside the fence and no
worker tool could read it back — the recovery pointer C2 is about. The
middleware also bound the construction-time backend verbatim, while
`FilesystemMiddleware` rebinds the sandbox per run; a shared deployment could
therefore summarize one tenant while writing history into the process-wide
sandbox.

## Decision

`_make_summarization` hands deepagents `_EngagementSummarizationBackend`, a
`CompositeBackend` subclass that is also callable:

1. At construction it carries `artifacts_root="/workspace"`, so the middleware
   computes `/workspace/conversation_history/{thread_id}.md`.
2. When deepagents resolves the backend per summarization (its `_get_backend`
   calls a callable backend with the live `ToolRuntime`), it returns exactly
   what `FilesystemMiddleware._get_backend` returns — the per-run sandbox
   rebound from `runtime.config` and the engagement workspace wrapper applied.
   A missing or invalid workspace uses the same fail-closed wrapper as the
   worker filesystem tools. Offload then returns `file_path=None`, instead of
   writing a file that the worker cannot read.

This changes where the offload file is written and the path the summary
names. Like WP-A1 it is a defect fix rather than an optional behavior, so it
ships enabled with no flag (plan §11 lists no gate for A2); the engagement
fence is untouched — the wrapper maps the same virtual path the filesystem
tools already map.

## Threat model

No guardrail, egress, RoE, or executor changes. The defect is a
correctness/recoverability one: an evicted-context pointer that no agent tool
could resolve and that a shared deployment could route to the wrong tenant.
The wrapper *strengthens* tenant isolation by routing summarization through
the same per-engagement mapping as every other filesystem operation. The
sandbox fence logic in `execution/sandbox/server/app.py` is not modified.

## Consequences

- **Easier:** compaction is recoverable — the pointer opens via `read_file`;
  multi-tenant summarization writes to the run's own sandbox.
- **Harder:** summarization now depends on the same per-run resolution as the
  filesystem stack; a broken sandbox resolution degrades offload to
  `file_path=None` (deepagents' fail-open contract) instead of silently
  writing somewhere reachable by no one.
- **Migration:** none for on-disk data; old `/conversation_history/*` files
  (if any) are simply orphaned.
- **Given up:** unscoped offloads without a workspace. Launcher pointers now
  use `/workspace/conversation_history`; shared mode additionally maps that
  virtual location into the engagement directory.

## Alternatives considered

- Pass `artifacts_root="/workspace"` without a callable backend — rejected:
  fixes the path but keeps the process-wide sandbox binding, so a shared
  deployment still writes to the wrong tenant's sandbox.
- Patch deepagents' `_history_path_prefix` after construction — rejected:
  unsupported reach into a vendored dependency and wrong per run.
- Relax the ADR-0042 fence to allow `/conversation_history` — rejected:
  weakens a security boundary to paper over a path-mapping bug.
