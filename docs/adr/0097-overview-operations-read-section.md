# ADR-0097: Read the operation bindings of the authorized projects as an overview section

- **Status:** Proposed — 2026-10-23. Not accepted; the repository owner decides.
- **Date:** 2026-10-23
- **Deciders:** repository owner (pending)
- **Related:** ADR-0096 (feature-owned Web presentation and adapters), ADR-0091 (handoff authorizes execution), `apps/web/.scratch/frontend-backend-integration/spec.md` (R03 authorization, R09 persistence), `docs/web-real-ui-implementation-plan.md` §5.1 and §6 (overview read models)

## Context

The System Overview shows six key figures. Two of them, active operations and open curated findings, read durable state
that is already in the server. The overview has no section for the operations themselves: the real presentation could only
show projects, findings, C2 commands and the task inbox, so the "active operations" figure had no source.

Operations in real mode are identified by their runtime thread, and the server keeps one durable `OperationBinding` row per
(engagement, thread) with a governance state (`bound`, `running`, `stopped` or `completed`). Governance transitions update
that row when an operation starts, stops or completes. The row is therefore the durable record the overview can count
without calling the runtime for every project. Live runtime status (run progress, branch outcomes) stays a per-project read.

The inbox service already gives each overview domain its own endpoint, so each section loads, degrades and is authorized
on its own. This decision keeps that pattern instead of adding one aggregate document.

## Decision

Add one read endpoint to the inbox routes:

- `GET /api/overview/operations` returns `OperationsSummaryView`: `counts` (bindings per governance state across the
  actor's authorized engagements), `recent` (the ten newest bindings with engagement name, thread identity, state and
  update time), `engagements` (authorized count), `truncated` (true when the scan reaches 5 000 rows), and `source: 'db'`.
- Authorization: the same `authorizedEngagements(actorId)` scope the findings and C2 sections use. Owned engagements and
  memberships only; a foreign engagement contributes nothing, and an unauthenticated request gets 401.
- No runtime call, no new table and no migration. The endpoint reads `OperationBinding` rows and nothing else.
- The browser keeps the `running` count as the "active operations" figure and labels it as the binding state. It does not
  present the binding state as live run progress.

Agent instances and live sessions are not part of this decision. They come from runtime or provider reads per project; the
overview shows them as "Per project" rather than counting them globally.

## Consequences

- The overview gains one durable, authorized figure and can link each binding to its operation by thread identity.
- The count reflects governance transitions. A run that the runtime has failed but governance has not yet transitioned can
  still show as `running`. Live run status stays in the project's Execution section, which the overview links to.
- A deployment with many bindings is bounded by the 5 000-row scan; `truncated` says when counts are a lower bound.
- Acceptance before this ADR is accepted: server tests for authorization and scope (`tests/t15-inbox.test.ts`), the
  presentation tests for not-recorded and unavailable states, and one browser check of the overview in real mode on an
  isolated stack. None of these is a substitute for the owner's acceptance of the endpoint.

## Alternatives considered

- **One aggregate overview document.** Rejected: it would couple six independent sources, and one failing source would
  blank the whole dashboard, which the inbox service explicitly avoids.
- **Fan out to each project's runtime from the browser.** Rejected: the browser would call one runtime per project on every
  refresh, and a project the actor cannot read would leak through the fan-out.
- **Count live runs through the runtime from the server.** Rejected for this decision: it adds runtime coupling and latency
  to a summary endpoint, and the runtime's availability would then gate the overview. It can be proposed later as its own
  section with its own ADR.
