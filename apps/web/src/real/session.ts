/**
 * Real-mode trusted session seam (ADR-0068). Split out of
 * `screens/login.tsx` (structural hardening, 2026-10-16 — see
 * docs/design/2026-10-16-web-screens-unification-implementation-plan.md)
 * so `state/console.ts`'s `useMe()` depends on a plain data hook instead of a
 * presentation module; `screens/login.tsx` keeps the sign-in/sign-out JSX and
 * imports this seam like any other consumer.
 */
import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAuthSession, type AuthSessionView } from './api'

export const SESSION_KEY = ['real', 'session'] as const

export interface SessionState { session: AuthSessionView | null; pending: boolean; error: Error | null; retry: () => void; deploymentId?: string }

export const SessionContext = createContext<SessionState | null>(null)

/** Resolves the trusted session (null when the server is single-user local). */
export function useSession(): SessionState {
  const trusted = useContext(SessionContext)
  const list = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => fetchAuthSession(),
    staleTime: 60_000,
    enabled: trusted === null,
  })
  return trusted ?? { session: list.data ?? null, pending: list.isPending, error: list.error, retry: () => { void list.refetch() } }
}
