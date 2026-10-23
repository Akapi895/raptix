/** Real project and membership caches are namespaced by the signed-in actor, not the fixed local identity. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { CapabilitiesDocument } from '@raptix/web-contracts'
import type { AuthSessionView } from '../../platform/auth-api'
import { SessionContext, type SessionState } from '../../platform/session'
import { RealContext } from '../../state/real-context'
import { REAL_IDENTITY } from '../../state/real-identity'
import { useRealMembershipRole, useRealProjects } from './query'

vi.mock('./remote', async (importOriginal) => ({ ...(await importOriginal<typeof import('./remote')>()), listEngagements: vi.fn(async () => []) }))
vi.mock('../team', async (importOriginal) => ({ ...(await importOriginal<typeof import('../team')>()), fetchMembers: vi.fn(async () => ({ engagementId: 'eng-1', mode: 'multi-user', members: [], canManage: false, inviteSupported: false, reason: null, source: 'db' })) }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const DOCUMENT: CapabilitiesDocument = { version: 1, mode: 'multi-user', capabilities: { projects: { supported: true, available: true }, members: { supported: true, available: true } } }

const signedIn = (id: string): AuthSessionView => ({ authenticated: true, actor: { id, username: id, displayName: id }, mode: 'multi-user' })

function harness(session: AuthSessionView | null, client: QueryClient) {
  const state: SessionState = { session, pending: false, error: null, retry: () => {} }
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RealContext.Provider value={{ document: DOCUMENT, identity: REAL_IDENTITY }}>
        <SessionContext.Provider value={state}>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </SessionContext.Provider>
      </RealContext.Provider>
    )
  }
}

const newClient = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } })

it('caches the project list under the signed-in actor, never under the local identity', async () => {
  const client = newClient()
  renderHook(() => useRealProjects(), { wrapper: harness(signedIn('actor-b'), client) })
  await waitFor(() => expect(client.getQueryState(['real', 'projects', 'actor-b'])?.status).toBe('success'))
  expect(client.getQueryState(['real', 'projects', REAL_IDENTITY.id])).toBeUndefined()
})

it('falls back to the local identity on a single-user server with no session', async () => {
  const client = newClient()
  renderHook(() => useRealProjects(), { wrapper: harness(null, client) })
  await waitFor(() => expect(client.getQueryState(['real', 'projects', REAL_IDENTITY.id])?.status).toBe('success'))
})

it('namespaces the membership read by the signed-in actor as well', async () => {
  const client = newClient()
  renderHook(() => useRealMembershipRole('eng-1', 'actor-b'), { wrapper: harness(signedIn('actor-b'), client) })
  await waitFor(() => expect(client.getQueryState(['real', 'members', 'actor-b', 'eng-1'])?.status).toBe('success'))
  expect(client.getQueryState(['real', 'members', REAL_IDENTITY.id, 'eng-1'])).toBeUndefined()
})
