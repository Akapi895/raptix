/**
 * The project overview counts come from the feature hooks that own their sources. A failed source shows "No source"
 * for its own row only; AI suggestions are a separate row and never part of the verified total.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type Read<T> = { isPending: boolean; isError: boolean; data?: T }

const hooks = vi.hoisted(() => ({
  findings: { isPending: false, isError: false, data: undefined } as Read<unknown>,
  assets: { isPending: false, isError: false, data: undefined } as Read<unknown>,
  fleet: { isPending: false, isError: false, data: undefined } as Read<unknown>,
}))

vi.mock('../../findings', () => ({ useFindingList: () => hooks.findings }))
vi.mock('../../assets', () => ({ useAssetList: () => hooks.assets }))
vi.mock('../../operations', () => ({ useRuntimeFleet: () => hooks.fleet }))

const findingsView = {
  severity: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
  counts: { all: 2, confirmed: 1, review: 1, ai: 4, drafts: 0, remediation: 0 },
  awaitingReview: 1,
  resolved: 0,
}

// The first import loads the feature entries; keep that cold start out of the test timer.
beforeAll(async () => {
  await import('./project-counts')
}, 30_000)

afterEach(() => {
  cleanup()
  hooks.findings = { isPending: false, isError: false, data: undefined }
  hooks.assets = { isPending: false, isError: false, data: undefined }
  hooks.fleet = { isPending: false, isError: false, data: undefined }
})

async function renderCounts(): Promise<void> {
  const { ProjectCounts } = await import('./project-counts')
  render(<ProjectCounts engagementId="eng-1" />)
}

describe('ProjectCounts', () => {
  it('counts the verified findings and shows AI suggestions on their own row', async () => {
    hooks.findings = { isPending: false, isError: false, data: findingsView }
    hooks.assets = { isPending: false, isError: false, data: { total: 3 } }
    hooks.fleet = { isPending: false, isError: false, data: { counts: { activeRuns: 2 } } }
    await renderCounts()
    expect(screen.getByText('Curated findings')).toBeTruthy()
    expect(screen.getByText('in review 1 · confirmed 1 · resolved 0')).toBeTruthy()
    // The verified total is the sum of the severities (2), not the four AI suggestions.
    expect(screen.getByText('2', { selector: 'span.block' })).toBeTruthy()
    expect(screen.getByText('4', { selector: 'span.block' })).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.queryByText('No source')).toBeNull()
  })

  it('shows "No source" for a failed findings read and keeps the other rows', async () => {
    hooks.findings = { isPending: false, isError: true, data: undefined }
    hooks.assets = { isPending: false, isError: false, data: { total: 0 } }
    hooks.fleet = { isPending: false, isError: false, data: { counts: { activeRuns: 0 } } }
    await renderCounts()
    expect(screen.getAllByText('No source')).toHaveLength(2)
    expect(screen.getAllByText('0')).toHaveLength(2)
  })

  it('shows a loading mark while a read is pending', async () => {
    hooks.findings = { isPending: true, isError: false, data: undefined }
    hooks.assets = { isPending: false, isError: false, data: { total: 1 } }
    hooks.fleet = { isPending: false, isError: false, data: { counts: { activeRuns: 1 } } }
    await renderCounts()
    expect(screen.getAllByText('…')).toHaveLength(2)
  })
})
