# 26: Immutable report snapshot jobs

**What to build:** Reports tạo versioned JSON/Markdown từ một consistent snapshot của actual engagement/findings/evidence.
**Blocked by:** 22 — Finding editor; 23 — Evidence retention.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR defines durable report job/snapshot/artifact ownership, source revision manifest and compatibility with current direct export.
2. Capture consistent permitted source records; retain report version, finding/evidence revisions và redacted metadata.
3. Persist job lifecycle/request identity then generate retained JSON/Markdown artifacts; prevent duplicate mutation on replay.
4. Add report version/history/status/detail/download UI; later source edits offer new version rather than mutating old bytes.
5. Show failure/uncertain/partial-source outcome; missing evidence remains explicit in manifest.

## Acceptance criteria
- [ ] Snapshot/artifact stable after source changes/restart.
- [ ] Download contains actual source identities and no raw Vault secrets.
- [ ] Job replay returns same report/version; failed generation not ready.

## Test / expected result
L13 generate, edit source during/after job, reload/restart/download JSON+Markdown and compare manifests/digests. Invalid source/reference failure visible.

## Completion evidence
Job decision, source manifest, report IDs/versions/digests and persistence/replay results.
