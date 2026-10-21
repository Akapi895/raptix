/** Finding wire responses must preserve ownership and nested workflow identity. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addCuratedFindingComment, fetchCuratedFindings, transitionCuratedFinding } from '../features/findings/remote';
import type { CuratedFindingView } from '@raptix/web-contracts';

const finding: CuratedFindingView = {
  id: 'finding-1', engagementId: 'eng-1', title: 'Observed issue', severity: 'high', status: 'returned',
  body: { detail: 'Observed in staging.' }, expectedVersion: 3, sourceType: 'authored', producerRef: null,
  createdBy: 'author', updatedBy: 'reviewer', createdAt: '2026-10-17T09:00:00.000Z', producerDigest: null, lastReviewDecision: null, updatedAt: '2026-10-17T10:00:00.000Z', evidence: [],
  references: { assetId: null, bindingId: null, threadId: null, runId: null, techniqueId: null }, activityCursors: { comments: null, history: null, retests: null },
  comments: [{ id: 'comment-1', actorId: 'reviewer', createdAt: '2026-10-17T10:00:00.000Z', text: 'Add evidence.', findingVersion: 3 }],
  history: [], retests: [],
}

function respond(body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

afterEach(() => vi.unstubAllGlobals())

describe('curated finding wire guards', () => {
  it.each([
    { ...finding, comments: [null] },
    { ...finding, comments: [{ ...finding.comments![0], findingVersion: -1 }] },
    { ...finding, body: { detail: 'Observed.', impact: 42 } },
    { ...finding, status: 'invented-success' },
    { ...finding, severity: 'invented-critical' },
    { ...finding, engagementId: 'foreign-engagement' },
    { ...finding, evidence: [{ id: 'link-1', engagementId: 'foreign-engagement', kind: 'digest', artifactPath: null, digest: 'a'.repeat(64), producer: null, createdAt: finding.updatedAt }] },
  ])('rejects malformed or foreign nested records %#', async (invalid) => {
    respond({ engagementId: 'eng-1', source: 'db', transitions: {}, findings: [invalid] })
    await expect(fetchCuratedFindings('eng-1')).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('rejects a mutation acknowledgement for a different finding', async () => {
    respond({ ...finding, id: 'finding-foreign' })
    await expect(addCuratedFindingComment('eng-1', 'finding-1', { text: 'Add evidence.', expectedVersion: 2, requestId: 'request-1' })).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('rejects a transition acknowledgement from a foreign engagement', async () => {
    respond({ ...finding, engagementId: 'eng-foreign' })
    await expect(transitionCuratedFinding('eng-1', 'finding-1', 'returned', 2, 'Add evidence.')).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('accepts a versioned returned decision without relabeling it draft', async () => {
    respond(finding)
    await expect(transitionCuratedFinding('eng-1', 'finding-1', 'returned', 2, 'Add evidence.')).resolves.toMatchObject({ status: 'returned', expectedVersion: 3 })
  })
})
