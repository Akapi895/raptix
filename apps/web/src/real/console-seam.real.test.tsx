/**
 * The console read seam in real mode (integration ticket 03): the identity is
 * the trusted local operator, project lists come from the engagement API and
 * the demo database projection is unreachable.
 *
 * The mode must be seeded BEFORE the dynamic imports below — module
 * evaluation resolves DATA_MODE exactly once (ADR-0068).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

window.localStorage.clear()
window.localStorage.setItem('raptix.dataMode', 'real')
vi.stubEnv('VITE_DATA_MODE', 'real')

const { cleanup, renderHook, waitFor } = await import('@testing-library/react')
const { Component } = await import('react')
const { DATA_MODE } = await import('../state/mode')
const { RealModeProvider } = await import('./bootstrap')
const { useDb, useMe, usePolicyProjects } = await import('../state/console')

beforeEach(() => {
  const capabilities = { version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true } } }
  const engagement = {
    id: 'eng-8f3c92a1', workspaceSlug: 'q1-external-assessment', displayName: 'Q1 External Assessment',
    targetType: 'web_url', targetValue: 'https://target.example.test', authorizationConfirmed: true,
    brief: null, handoffConfirmedAt: null, metadataState: 'verified', lifecycleStatus: 'planning',
    findingCount: null, assetCount: null, activeAgentCount: null,
    createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T09:30:00.000Z',
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/capabilities')) return new Response(JSON.stringify(capabilities), { status: 200 })
    if (url.endsWith('/api/auth/session')) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify([engagement]), { status: 200 })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Captures a child's render-time throw so failing-fast hooks can be asserted. */
class RenderErrorBoundary extends Component<{ children: ReactNode; onError: (error: unknown) => void }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error)
  }
  render() {
    return this.state.hasError ? null : this.props.children
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  return <RealModeProvider>{children}</RealModeProvider>
}

describe('console seam in real mode', () => {
  it('resolves to real mode', () => {
    expect(DATA_MODE).toBe('real')
  })

  it('exposes the trusted local operator instead of a demo persona', async () => {
    const { result } = renderHook(() => useMe(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current).toBeTruthy())
    expect(result.current.name).toBe('Local Operator')
    expect(result.current.role).toBe('admin')
  })

  it('feeds usePolicyProjects from the engagement API through the shared mapping', async () => {
    const { result } = renderHook(() => usePolicyProjects(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current).toHaveLength(1))
    const project = result.current[0]
    expect(project.id).toBe('eng-8f3c92a1')
    expect(project.name).toBe('Q1 External Assessment')
    expect(project.status).toBe('planning')
    expect(project.client).toBe('')
    expect(project.roeStatus).toBe('none')
  })

  it('keeps the demo database projection unreachable', async () => {
    let caught: unknown = null
    renderHook(() => useDb(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <RealModeProvider>
          <RenderErrorBoundary onError={(error) => { caught = error }}>{children}</RenderErrorBoundary>
        </RealModeProvider>
      ),
    })
    await waitFor(() => expect(caught).not.toBeNull())
    expect(String(caught)).toMatch(/demo database projection is unavailable/)
  })
})
