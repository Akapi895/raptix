# 0067. Enforce a single service/domain boundary in the web console frontend

- **Status:** Proposed
- **Date:** 2026-10-13
- **Deciders:** @Akapi895
- **Related:** `apps/web-improve/.scratch/web-improve-refactor/spec.md` and
  `execution.md` (the migration contract this ADR underwrites); the root
  `GLOSSARY.md` evidence vocabulary; ADR-0009 (outside-the-LLM-trust-boundary
  HITL principle, whose approval-gating surface the console mirrors);
  ADR-0039 (handlers stay outside the runtime — the same boundary discipline
  applied to frontend tooling)

## Context

The web console (`apps/web-improve`) is a Figma Make export whose entire
"backend" is one React Context holding a seeded in-memory database plus ~70
action methods. Screens import the store, the seed module and the UI kit
directly; navigation is hand-parsed hashes; there are no tests. The refactor
spec introduces a feature-first architecture with TanStack Query for entity
data, and the execution contract requires that a legacy mutation is observed
by migrated consumers and vice versa, that project/persona switches never
restore stale cross-project visibility, and that demo reset is deterministic
— all while operational safety invariants (preflight gating, emergency stop,
four-eyes, grant expiry, closure checklist) keep executing somewhere real and
testable.

The non-obvious part is that during a long migration both execution sites
must stay live at once. If services keep a second copy of the dataset, or if
legacy actions and service handlers each own half of a workflow, the safety
invariants split across two authorities and none of them can be asserted.
The same applies to time: the export pins a demo date, while expiry rules
(grant deadlines, 24-hour plan approvals) need absolute-instant semantics.

## Decision

The frontend gets exactly one data authority: a single seeded database behind
an atomic transaction/subscription bridge. A typed service factory exposes
per-entity handlers that receive actor, project and a clock as explicit
context; components never inspect the database directly. Legacy store actions
delegate to a handler once that handler owns the behavior, and until then
commit through the shared transaction bridge; both paths publish affected
entity/project identities that drive Query invalidation and legacy
subscriptions from one place. The mock clock advances elapsed time as
absolute instants anchored to the dataset's demo date; expiry enforcement
lives in handlers, not in tests or screens. Feature handlers are owned by
their feature tickets; shared contracts, the bridge, the factory and shared
stores have single named owners per the tracker's shared-write table.

## Consequences

### Typed runtime refinement (ticket 67)

Synchronous UI continuity is supported by narrow, feature-owned service
projections over the same authority. A projection names its view fields and
accepts actor/project (and entity identity where appropriate); it applies
membership before exposing relationships or derived decisions. It never
returns `Db`, an authority snapshot, or a generic table-selection interface.
React subscriptions observe projection results through the one authority's
change publication, with stable results between commits. Existing async
list/detail/aggregate Query models remain the primary entity reads.

Identity and project-policy helpers may remain synchronous and narrow.
Organization role overrides participate in both Query keys and captured
request actors; superseding a role cancels the obsolete read scope just as
switching persona or project does. Component writes call typed owning-service
transactions, including audit and notification effects; components do not
commit authority callbacks. This trades extra explicit view contracts for
preserving immediate UI updates without reinstating a whole-database hook.

- **Easier:** safety invariants stay testable at one execution site as they
  migrate; mock-to-real API swap becomes a factory change; parallel feature
  work is merge-safe because shared surfaces have declared owners.
- **Harder:** every feature migration must route writes through the bridge
  rather than mutating state directly; the integrator serializes contract and
  provider-composition changes.
- **Given up:** the convenience of components reading the seed database
  directly, and of ad-hoc per-feature state stores.
- **Migration:** tickets 03–05 land the contracts, the bridge and the shared
  stores; ticket 04 owns the authority move; retirement tickets (65–67) remove
  the compatibility wrappers once no caller remains.

## Alternatives considered

- **Strangler per feature with per-feature seeds:** each feature brings its own
  mock store. Rejected because scope isolation, estop propagation and the
  approval invariants span features; a second seed would fork the safety
  state.
- **Replace the store in one rewrite.** Rejected: violates the repo's
  ≤400-line/≤10-file change budget and cannot stay green per PR.
