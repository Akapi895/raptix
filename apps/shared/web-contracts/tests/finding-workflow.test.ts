import { describe, expect, it } from 'vitest'
import { isFindingActivityPage, isFindingReferences, isFindingSuggestionDisposition } from '../src/finding-workflow.js'

describe('finding workflow wire boundaries', () => {
  it('rejects unowned execution identities that omit their thread', () => {
    expect(isFindingReferences({ assetId: null, bindingId: null, threadId: null, runId: 'run-1', techniqueId: null })).toBe(false)
    expect(isFindingReferences({ assetId: 'asset-1', bindingId: null, threadId: 'thread-1', runId: 'run-1', techniqueId: 'T1059' })).toBe(true)
  })

  it('rejects malformed activity and events beyond the pinned version', () => {
    const page = { engagementId: 'eng-1', findingId: 'finding-1', kind: 'comments', version: 2, nextCursor: null, items: [{ id: 'comment-1', actorId: 'actor-1', createdAt: '2026-10-17T10:00:00.000Z', findingVersion: 2, text: 'Observed.', action: 'commented', reason: null, fromStatus: 'review', toStatus: 'review', result: null, note: null, evidenceRefs: [] }] }
    expect(isFindingActivityPage(page)).toBe(true)
    expect(isFindingActivityPage({ ...page, items: [null] })).toBe(false)
    expect(isFindingActivityPage({ ...page, version: 1 })).toBe(false)
  })

  it('requires a canonical source path and a persisted disposition version', () => {
    expect(isFindingSuggestionDisposition({ producerRef: '../FIND-1.md', dismissed: true, reason: 'Duplicate.', version: 1 })).toBe(false)
    expect(isFindingSuggestionDisposition({ producerRef: 'findings/FIND-1.md', dismissed: true, reason: 'Duplicate.', version: 0 })).toBe(false)
    expect(isFindingSuggestionDisposition({ producerRef: 'findings/FIND-1.md', dismissed: true, reason: 'Duplicate.', version: 1 })).toBe(true)
  })
})
