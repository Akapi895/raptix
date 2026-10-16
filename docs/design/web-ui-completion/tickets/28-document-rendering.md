# 28: PDF/DOCX rendering và downloads

**What to build:** Web tạo PDF/DOCX thật qua durable jobs, giữ file tải được và phục hồi renderer failure.
**Blocked by:** 27 — Report templates và matching preview.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR selects smallest supported render boundary/dependencies and bounded job execution; isolate manifest/dependency work from feature PR as required.
2. Convert versioned snapshot/template into PDF/DOCX with Unicode fonts, tables/page-break rules and retained source refs.
3. Persist actual completed artifact metadata/digest only after successful render; retry/reconcile defined for worker interruption.
4. Wire queued/running/failed/ready UI, cancel where supported and authorized download with correct MIME/filename.
5. Limit rendering inputs/resources/remote fetches through renderer boundary, not a fake success timer.

## Acceptance criteria
- [ ] PDF text and DOCX document content parse with expected Vietnamese findings/tables.
- [ ] Actual bytes downloadable after restart, match retained digest.
- [ ] Renderer failure/interruption produces inspectable failed/uncertain job, no ready artifact.

## Test / expected result
L13 browser download + PDF text extraction + DOCX ZIP/XML inspection. Kill renderer mid-job, retry and verify no duplicate report identity. Large report follows documented cap/job policy.

## Completion evidence
Renderer decision/version, actual file digests/MIME/parse results, visual page sample and fault recovery outcomes.
