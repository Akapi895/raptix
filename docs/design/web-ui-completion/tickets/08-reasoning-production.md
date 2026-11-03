# 08: Production reasoning transport

**What to build:** Clean deployment giữ trace khi model cung cấp, không phụ thuộc docker-cp và không phá models không-thinking.
**Blocked by:** None (can start immediately).
**Priority / Profile:** P0 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Review existing uncommitted LLM wrapper/override changes and field semantics; preserve raw public answer separately from optional reasoning.
2. Exercise default factory, supported model override and provider-key override call paths; type errors/provider failures keep original semantics.
3. Align stream/checkpoint public projections without exporting private graph/child compaction state.
4. Run focused Python + Web contract checks, then clean image build; remove operational reliance on container copy.
5. Verify unsupported/non-thinking model gracefully emits no THINKING toggle, not empty/fabricated content.

## Acceptance criteria
- [ ] Real model trace persists in live/history from a source-built image.
- [ ] Non-reasoning model produces normal readable answer without regression.
- [ ] No secrets/private channel bookkeeping appears in public DTOs.

## Test / expected result
L06 two model types through every changed factory/override seam; focused LLM tests plus actual inference. Provider failure remains visible, not substituted by an empty success.

## Completion evidence
Reviewed diff, exact image/revision, model identity, public payload/reload evidence and failure-path results.
