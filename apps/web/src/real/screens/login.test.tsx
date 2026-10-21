/** Session-boundary regressions against the real gate and QueryClient. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { RealLoginGate } from './login'
import { SESSION_KEY } from '../../platform/session'
import { saveWorkspaceDraft } from '../workspace-session'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const session = (id: string) => ({ authenticated: true, actor: { id, username: id, displayName: id }, mode: 'multi-user', csrfToken: 'test-csrf' })
function History({ load }: { load: () => Promise<string> }) {
  const history = useQuery({ queryKey: ['real', 'thread', 'eng-1', 'thread-1'], queryFn: load })
  return <p>{history.data ?? 'Loading'}</p>
}

it('a new authenticated actor never observes the previous actor in-flight history', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(SESSION_KEY, session('actor-a'))
  let resolve!: (value: string) => void
  const pending = new Promise<string>(done => { resolve = done })
  const load = vi.fn<() => Promise<string>>().mockImplementationOnce(() => pending).mockResolvedValue('ACTOR_B_HISTORY')
  render(<QueryClientProvider client={client}><RealLoginGate><History load={load} /></RealLoginGate></QueryClientProvider>)
  await act(async () => { client.setQueryData(SESSION_KEY, session('actor-b')) })
  await act(async () => { resolve('ACTOR_A_PRIVATE_HISTORY'); await pending })
  expect(await screen.findByText('ACTOR_B_HISTORY')).toBeInTheDocument()
  expect(screen.queryByText('ACTOR_A_PRIVATE_HISTORY')).toBeNull()
})

it('an authenticated actor change erases previous-session plaintext recovery', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(SESSION_KEY, session('actor-a'))
  saveWorkspaceDraft('eng-1', 'thread-1', 'ACTOR_A_PRIVATE_DRAFT', 'actor-a')
  render(<QueryClientProvider client={client}><RealLoginGate><p>Authenticated</p></RealLoginGate></QueryClientProvider>)
  await act(async () => { client.setQueryData(SESSION_KEY, session('actor-b')) })
  await waitFor(() => {
    const remaining = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index)!))
    expect(remaining).not.toContain('ACTOR_A_PRIVATE_DRAFT')
  })
})
