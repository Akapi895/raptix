/**
 * W18: the tradecraft library list discloses the real proposal contract
 * (engagement-scoped review workflow) instead of a stale exclusion banner,
 * pages large skill lists instead of silently truncating at 100, and links
 * a skill to its proposal queue.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { LibraryView } from '../api'

const fetchLibrary = vi.fn()

vi.mock('../api', () => ({
  fetchLibrary: (...a: unknown[]) => fetchLibrary(...a),
  fetchLibrarySkill: vi.fn(),
  fetchLibraryTechnique: vi.fn(),
}))

vi.mock('../../router/navigate', () => ({
  go: vi.fn(),
  useRoute: () => ({ page: 'library' }),
}))

function libraryView(skillCount: number): LibraryView {
  return {
    skills: Array.from({ length: skillCount }, (_, i) => ({
      name: `skill-${i}`,
      description: `description ${i}`,
      subdomain: null,
      mitreIds: [],
      whenToUse: null,
      path: null,
    })),
    counts: { skills: skillCount, techniques: 42 },
    excludedActions: ['skill-revision-submit', 'skill-revision-review'] as const,
    sources: { skills: 'knowledge-graph' },
    source: 'graph',
  } as unknown as LibraryView
}

async function renderList(): Promise<void> {
  const { RealLibrary } = await import('./library')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealLibrary />, { wrapper })
}

beforeEach(() => {
  fetchLibrary.mockReset().mockResolvedValue(libraryView(150))
})

afterEach(() => {
  cleanup()
})

describe('RealLibrary (W18 banner and pagination)', () => {
  it('discloses the engagement-scoped proposal workflow instead of a stale no-contract banner', async () => {
    await renderList()
    expect(await screen.findByText(/body-replacement proposals run through the engagement-scoped review workflow/i)).toBeInTheDocument()
    expect(screen.queryByText(/has no contract on purpose/i)).not.toBeInTheDocument()
  })

  it('pages the skill list with an explicit load-more control', async () => {
    await renderList()
    expect(await screen.findByText('skill-99')).toBeInTheDocument()
    expect(screen.queryByText('skill-140')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /show more skills/i }))
    expect(await screen.findByText('skill-140')).toBeInTheDocument()
  })
})
