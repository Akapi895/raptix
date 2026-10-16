# 29: Evidence-grounded AI compilation

**What to build:** AI tạo report draft từ retained source snapshot, citations inspectable và operator review trước final version.
**Blocked by:** 15 — Model settings; 26 — Report snapshots; 27 — Templates.
**Priority / Profile:** P2 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define typed compilation input/output, selected model snapshot và evidence-citation validation; reuse report job boundary.
2. Supply authorized bounded source material, excluding unrelated secrets/private channels; preserve claim versus verified evidence distinctions.
3. Persist generated draft/citations/model identity and quality flags; unsupported assertions flagged, not converted to verified findings.
4. Wire compile/progress/compare/edit/review/approve controls; approval generates a new reviewed content revision.
5. Handle provider failure/budget/context truncation and replay without losing original source/report snapshot.

## Acceptance criteria
- [ ] Draft citations resolve to retained sources and expose unsupported assertions.
- [ ] AI cannot silently add verified findings or auto-finalize unreviewed deliverable.
- [ ] Model/failure/review provenance persists after restart.

## Test / expected result
L13 actual AI compilation; unsupported source assertion and missing citation deterministic tests. Provider outage yields failed job with source intact; reviewed draft can be rendered via existing artifact path.

## Completion evidence
Source/model manifest, draft/citation review, approved revision and actual AI/failure trace.
