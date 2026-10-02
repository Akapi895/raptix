# 0029. KG freshness refresh before model call (Step 2 of control-plane fixes)

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** @PurpleCHOIms
- **Related:** [ARCHITECTURE_AUDIT.md](../../ARCHITECTURE_AUDIT.md), [ARCHITECTURE_AUDIT_FIX.md](../../ARCHITECTURE_AUDIT_FIX.md), [ADR-0027](0027-baseline-freeze-for-control-plane-fixes.md), [ADR-0028](0028-typed-dispatch-failure-outcome.md)

## Context

The architecture audit identified P0-2: KG summary is stale in the
tool→model loop. `KGMiddleware` hydrates the summary in `before_agent`,
but the tool→model loop returns to `before_model` / model, not
`before_agent`. A KG write in one tool turn is invisible to the next
model turn in the same invocation.

The audit also identified two related bugs in `KGStore`:

1. `revision()` uses `coalesce(max(n.lastupdated), 0)` — only looks at
   **nodes**, not edges. Edge-only mutations do not bump the revision.
2. `record_observations()` uses `update_tag = int(time.time())` — all
   writes in the same second get the same tag. Same-second writes
   produce indistinguishable revisions.

The follow-up review (`ARCHITECTURE_AUDIT_FIX.md` §2) specified the
fix:

> "Ở bước này **không đổi schema, không thêm session/credential vào
> summary**. Chỉ làm một việc: cùng format hiện tại nhưng refresh
> đúng lúc."

The review also required two regression cases:

1. Edge-only mutation must bump revision.
2. Two mutations within the same second must produce distinguishable
   revisions.

## Decision

We fix the KG freshness lifecycle with three changes:

### 1. `KGStore.revision()` includes edge `lastupdated`

The Cypher query now `OPTIONAL MATCH`es edges and returns both
`node_rev` and `edge_rev`. The returned token uses `max(node_rev,
edge_rev)` so either advancing bumps the token.

```cypher
MATCH (n) WHERE n.engagement = $engagement
OPTIONAL MATCH ()-[r]->() WHERE r.engagement = $engagement
RETURN coalesce(max(n.lastupdated), 0) AS node_rev,
       coalesce(max(r.lastupdated), 0) AS edge_rev
```

### 2. `KGStore.record_observations()` uses a monotonic sequence counter

`update_tag` is now `timestamp * 1_000_000 + seq` where `seq` is a
per-instance counter that increments on every write. Two writes
within the same second produce distinguishable tags. The counter
wraps at 1_000_000 (a safety valve — 1M writes/second is far outside
any realistic engagement window).

### 3. `KGMiddleware.before_model` refreshes when dirty

New `before_model` hook (and async `abefore_model`) that checks
`kg_revision`. When it equals the dirty marker set by `after_model`,
the hook re-fetches the real revision from the store and rebuilds
the summary. This closes the freshness gap where the tool→model loop
did not return to `before_agent`.

The `after_model` hook is unchanged — it still marks `kg_revision`
dirty when a KG write tool ran. The new `before_model` hook is the
consumer of that dirty marker.

## Consequences

- **Easier:** the planner sees fresh KG state on every model call,
  not just at agent entry. Edge-only mutations and same-second
  writes are now visible.
- **Easier:** the schema is unchanged. No new fields, no migration.
  The summary format is identical.
- **Harder:** every model call now does a `revision()` query against
  Neo4j. This is a small overhead per turn but necessary for
  freshness. The query is indexed on `engagement` so it should be
  fast.
- **Harder:** the `before_model` hook adds a state-update path that
  must be tested. The existing `before_agent` path is unchanged.
- **Given up:** the ability to batch multiple KG writes into a single
  revision bump. Each write now bumps the revision independently.
  This is the correct behavior for freshness but means the revision
  counter advances more frequently.
- **Migration:** none. The revision token format changes
  (`rev-{engagement}-{combined}` where `combined` is now
  `ts * 1_000_000 + seq` instead of `ts`), but the prefix
  `rev-{engagement}-` is unchanged so existing string comparisons
  still work.

## Alternatives considered

- **Refresh in `wrap_model_call` instead of `before_model`.** Rejected
  because `wrap_model_call` runs *after* the model has been called
  (it wraps the call), not before. `before_model` is the correct hook
  for pre-call refresh.
- **Use a database trigger to bump revision on any write.** Rejected
  because it requires schema migration and adds database-side
  complexity. The application-level fix is simpler and sufficient.
- **Use microsecond timestamps instead of a sequence counter.**
  Rejected because `time.time()` resolution varies by platform and
  may not provide microsecond precision. A sequence counter is
  deterministic and platform-independent.
- **Skip the edge-only fix and only fix the lifecycle.** Rejected
  because the audit explicitly identifies edge-only mutations as a
  regression case. Both fixes are required.
