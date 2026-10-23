/**
 * The asset list keeps the previous read on screen while a new filter or page is read. The next read replaces it when it
 * lands, so a filter click does not swap the table for a loading state.
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('../../state/feature-services', () => ({
  useFeatureServices: () => ({ assets: () => ({ list: (ctx: unknown, query: unknown) => hooks.list(ctx, query) }) }),
}))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))

const { useAssetList } = await import('./query')

function page(id: string) {
  return { items: [{ asset: { id, name: id } }], page: 1, pageSize: 50, total: 1, kpis: {}, owners: [], types: {}, sources: {}, oses: [], observation: 'ok' }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('asset list while a filter loads', () => {
  it('keeps the previous rows while the next filter is read, then shows the new rows', async () => {
    let release: (value: unknown) => void = () => {}
    hooks.list.mockImplementation((_ctx: unknown, query: { scope?: string }) => (
      query.scope === undefined
        ? Promise.resolve({ ok: true, data: page('web-01') })
        : new Promise((resolve) => { release = resolve })
    ))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result, rerender } = renderHook(({ query }: { query: { scope?: string } }) => useAssetList(query), { wrapper, initialProps: { query: {} } })
    await waitFor(() => expect(result.current.data?.items[0]?.asset.id).toBe('web-01'))

    rerender({ query: { scope: 'in' } })
    expect(result.current.isPlaceholderData).toBe(true)
    expect(result.current.data?.items[0]?.asset.id).toBe('web-01')

    release({ ok: true, data: page('web-in') })
    await waitFor(() => expect(result.current.data?.items[0]?.asset.id).toBe('web-in'))
    expect(result.current.isPlaceholderData).toBe(false)
  })
})
