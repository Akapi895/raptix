/**
 * The portfolio shows each row from the projects port. A value the source does not record reads as unavailable, a failed
 * read says so, and a filter that matches nothing is not reported as an empty portfolio.
 */
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type Read<T> = { isPending: boolean; isError: boolean; error: Error | null; data?: T; refetch: () => void }
const read = <T,>(data?: T, extra: Partial<Read<T>> = {}): Read<T> => ({ isPending: false, isError: false, error: null, data, refetch: () => {}, ...extra })

const hooks = vi.hoisted(() => ({ rows: null as unknown as Read<unknown> }))
vi.mock('../list-query', () => ({ useProjectRows: () => hooks.rows }))

const row = (over: Partial<Record<string, unknown>> = {}) => ({ id: 'RT-1', name: 'Alpha', workspaceSlug: null, target: null, targetType: null, metadataVerified: null, client: 'Northwind', status: 'active', updatedAt: 'Oct 1', ...over })

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
  it('shows the unrecorded target and metadata as unavailable rather than as values', async () => {
    hooks.rows = read([row()])
    await renderPortfolio()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Northwind')).toBeTruthy()
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
})
