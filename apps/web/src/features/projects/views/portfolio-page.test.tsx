/**
 * The portfolio shows each row from the projects port. A value the source does not record reads as unavailable, a failed
 * read says so, a filter that matches nothing is not reported as an empty portfolio, and a filter the source cannot answer
 * is not offered.
 */
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type Read<T> = { isPending: boolean; isError: boolean; error: Error | null; data?: T; refetch: () => void }
const read = <T,>(data?: T, extra: Partial<Read<T>> = {}): Read<T> => ({ isPending: false, isError: false, error: null, data, refetch: () => {}, ...extra })

const hooks = vi.hoisted(() => ({ rows: null as unknown as Read<unknown> }))
vi.mock('../list-query', () => ({ useProjectRows: () => hooks.rows }))

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'RT-1', name: 'Alpha', workspaceSlug: null, target: null, targetType: null, metadataVerified: null,
  status: 'active', updatedAt: 'Oct 1', updatedAtIso: null, ...over,
})

const daysAgo = (days: number): string => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

beforeAll(async () => {
  await import('./portfolio-page')
}, 30_000)

afterEach(() => {
  cleanup()
})

async function renderPortfolio(): Promise<void> {
  const { ProjectPortfolio } = await import('./portfolio-page')
  render(<ProjectPortfolio />)
}

describe('ProjectPortfolio', () => {
  it('shows the unrecorded target and metadata as Not recorded rather than as values, and has no client or status column', async () => {
    hooks.rows = read([row()])
    await renderPortfolio()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('—')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Client' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull()
  })

  it('does not show a zero review count when no project records metadata', async () => {
    hooks.rows = read([row()])
    await renderPortfolio()
    const tile = screen.getByText('Metadata to review').parentElement!
    expect(tile).toHaveTextContent('Not recorded')
    expect(tile).not.toHaveTextContent(/\b0\b/)
  })

  it('reports a failed read instead of an empty portfolio', async () => {
    hooks.rows = read(undefined, { isError: true, error: new Error('projects endpoint down') })
    await renderPortfolio()
    expect(screen.getByText('Could not load projects')).toBeTruthy()
    expect(screen.getByText('projects endpoint down')).toBeTruthy()
  })

  it('says when the filter matches nothing, and keeps the empty-portfolio message for no projects at all', async () => {
    hooks.rows = read([row({ name: 'Alpha' })])
    await renderPortfolio()
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'zzz-no-match' } })
    expect(screen.getByText('No projects match the filters')).toBeTruthy()
  })

  it('counts the projects in the stat tiles and filters the table by status chip', async () => {
    hooks.rows = read([row({ id: 'RT-1', name: 'Alpha', status: 'active' }), row({ id: 'RT-2', name: 'Beta', status: 'draft' })])
    await renderPortfolio()
    const group = screen.getByRole('group', { name: 'Filter by status' })
    expect(group.textContent).toContain('All2')
    expect(screen.getByText('Showing 2 of 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /draft/ }))
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Showing 1 of 2')).toBeTruthy()
  })

  it('offers the metadata and update-time filters only when the source records those values', async () => {
    hooks.rows = read([row()])
    await renderPortfolio()
    expect(screen.queryByLabelText('Filter by metadata')).toBeNull()
    expect(screen.queryByLabelText('Filter by update time')).toBeNull()
    expect(screen.queryByLabelText('Filter by target type')).toBeNull()
  })

  it('filters by update time and by metadata verification when the source records them', async () => {
    hooks.rows = read([
      row({ id: 'RT-1', name: 'Recent', metadataVerified: true, updatedAtIso: daysAgo(2) }),
      row({ id: 'RT-2', name: 'Stale', metadataVerified: false, updatedAtIso: daysAgo(90) }),
    ])
    await renderPortfolio()
    fireEvent.change(screen.getByLabelText('Filter by update time'), { target: { value: 'older' } })
    expect(screen.queryByText('Recent')).toBeNull()
    expect(screen.getByText('Stale')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter by update time'), { target: { value: 'any' } })
    fireEvent.change(screen.getByLabelText('Filter by metadata'), { target: { value: 'verified' } })
    expect(screen.getByText('Recent')).toBeTruthy()
    expect(screen.queryByText('Stale')).toBeNull()
  })

  it('clears every filter at once', async () => {
    hooks.rows = read([row({ id: 'RT-1', name: 'Alpha' }), row({ id: 'RT-2', name: 'Beta', status: 'draft' })])
    await renderPortfolio()
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'alpha' } })
    expect(screen.queryByText('Beta')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }))
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Showing 2 of 2')).toBeTruthy()
  })
})
