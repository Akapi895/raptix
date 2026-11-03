# 0088. Persist versioned finding workflow records

- **Status:** Accepted (2026-10-17, requester). Comments on `resolved` findings are refused (the resolved record is frozen); comments never change lifecycle status.
- **Date:** 2026-10-17
- **Related:** ADR-0069, ADR-0084, `docs/design/2026-10-17-web-ui-contract-completion-implementation-plan.md` D02/D03 and P05

## Context

Curated findings need comments, review reasons and retest observations that survive refresh and API restart. A mutable JSON array inside `FindingRecord.body` lacks independently addressable records and indexes. The security audit cannot substitute for missing business records. The requester chose a distinct `returned` status rather than mapping returned findings to drafts.

## Proposed decision

- Keep narrative fields (detail, impact, recommendation, severity rationale and scope note) in the versioned finding body. Add `FindingComment`, `FindingHistory` and `FindingRetest` records with opaque IDs, trusted actor, UTC time and finding version. History is append-only through the service.
- Comment and retest POSTs under the owned curated finding require `expectedVersion` and `requestId`. Replaying the same actor, finding, request ID and payload returns the committed result without repeating the mutation. Different content or actor conflicts. Version is a concurrency precondition for a new request; a committed request can be reconciled after the version advances.
- Finding changes, workflow records and audit entries commit in one database transaction. Compare-and-swap updates refuse stale content edits, decisions and observations. Narrative/evidence edits invalidate confirmation; comments do not change lifecycle status.
- Reviewer return requires an independent reviewer/owner and a reason, writes a decision/history entry and a comment, and persists `returned`. Editing returned content preserves that status until resubmission.
- Four-eyes checks include the original author and latest content/evidence editor. Discussion comments do not make the commenter the content author. An edit-and-submit writes content, status, history and audit in one transaction.
- Original legacy records without workflow records remain without history. Do not invent review actors, retests or business events from audit text. This additive migration creates tables; it does not rewrite existing bodies or infer business facts.

## Requester decisions and remaining P05 contracts

On 2026-10-17 the requester selected **Retest + evidence** and **per actor/path dismissal**:

- Resolution requires the `retest` stage, an explicit `Resolved` observation, a note and at least one classified retained capture. Each capture resolves in the owned engagement through the artifact authority, checking actor access and retained-byte integrity. Capture identities are persisted on the retest and its history event. Captures may be unlinked to the original finding, avoiding confirmation invalidation just to record new retest evidence. Direct `retest → resolved` is refused. Failed observations retain the remediation path.
- `FindingSuggestionDisposition` is unique by engagement, actor and producer path. Reload and source-byte changes do not restore a dismissal. Restore is explicit and versioned. The shared curated record remains the authority for imported state; repeated reads do not requeue an imported source.
- `GET .../curated-findings/:findingId/activity` takes `kind`, `version`, `cursor` and `limit` (default 20, maximum 100). Pages sort by finding version then identity, newest first; cursors must belong to that finding, activity kind and pinned version. Detail responses carry the newest 20 records per kind and explicit continuation cursors. The shared UI can load older pages.
- Managed asset, operation binding, owned execution thread/run and canonical technique identities are typed references. The service refuses cross-engagement identities, mismatched bindings, unknown runs and missing canonical techniques. Technique validation uses the existing library authority and never the browser's demo technique catalog.
- `GET .../curated-findings/options` supplies bounded owned reference choices and reports truncation. `GET/POST .../curated-findings/suggestions` reads only the current actor's dispositions and applies CAS decisions with transactional audit.

Reports and report snapshots remain P06 onward. P05 changes never rewrite existing report bodies or snapshots.

## Consequences

Records gain durable identities, indexed retrieval, transactional auditing and retry reconciliation. Storage and API complexity increase. Paging exposes partial history rather than silently claiming a complete timeline. Browser recovery stores hashed payload-scoped identities; storage failure refuses dispatch, and an old acknowledgement cannot clear a newer payload's identity.

## Alternatives

- **JSON arrays in finding body:** fewer tables, but weak identities, growth and paging semantics.
- **Derive business history from security audit:** avoids records but cannot establish missing business content or evidence relationships.
- **Resolve without an evidence observation:** rejected by the requester; a lifecycle status alone cannot establish that a fix was verified.
