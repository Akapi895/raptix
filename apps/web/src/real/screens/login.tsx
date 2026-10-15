/**
 * Real-mode session gate (integration ticket 07). Local single-user
 * deployments answer 404 on /api/auth/session and render children directly.
 * Multi-user deployments require a valid session: unauthenticated boots
 * render the sign-in form, and every mutation carries the per-session CSRF
 * token delivered here. The actor is trusted from the server session only —
 * the browser never posts a persona or role as authorization.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react'
import { fetchAuthSession, login, logout, type AuthSessionView } from '../api'
import { Button, Input } from '../../ui'

// eslint-disable-next-line react-refresh/only-export-components
export const SESSION_KEY = ['real', 'session'] as const

/** Resolves the trusted session (null when the server is single-user local). */
// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): { session: AuthSessionView | null; pending: boolean; error: Error | null; retry: () => void } {
  const list = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => fetchAuthSession(),
    staleTime: 60_000,
  })
  return { session: list.data ?? null, pending: list.isPending, error: list.error, retry: () => { void list.refetch() } }
}

function LoginForm({ onDone }: { onDone: () => void }): ReactElement {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const client = useQueryClient()

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login({ username, password })
      client.removeQueries({ predicate: (query) => query.queryKey[0] === 'real' && !['session', 'bootstrap'].includes(String(query.queryKey[1])) })
      await client.invalidateQueries({ queryKey: SESSION_KEY })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-fg">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6" aria-label="Sign in to the Raptix console">
        <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-subtle text-cyan"><ShieldCheck size={20} aria-hidden /></div>
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted">This deployment requires a Raptix account. Identity and roles are enforced server-side.</p>
        <div className="mt-5 space-y-3">
          <label className="block text-sm text-muted" htmlFor="login-username">Username</label>
          <Input id="login-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label className="block text-sm text-muted" htmlFor="login-password">Password</label>
          <Input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error !== null && <p className="mt-3 text-sm text-bad" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="mt-5 w-full justify-center" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <KeyRound size={16} aria-hidden />}
          Sign in
        </Button>
      </form>
    </div>
  )
}

/** Wraps the real console: local mode passes through, multi-user mode gates on a live session. */
export function RealLoginGate({ children }: { children: ReactNode }): ReactElement {
  const { session, pending, error, retry } = useSession()
  if (pending) {
    return <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Checking session"><Loader2 size={22} className="animate-spin text-muted" aria-hidden /></div>
  }
  if (error) return <div role="alert" className="p-6 text-bad">Session check failed: {error.message}<Button onClick={retry}>Retry session</Button></div>
  if (session === null || session.authenticated) {
    return <div key={session?.actor?.id ?? 'local'} className="contents">{children}</div>
  }
  return <LoginForm onDone={() => { /* session query invalidation re-renders the gate */ }} />
}

/** Standalone sign-in route (real mode 'login' page). */
export function RealLogin(): ReactElement {
  const client = useQueryClient()
  const { session } = useSession()
  if (session !== null && session.authenticated) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <div className="rounded-2xl border border-line bg-panel p-6">
          <p className="text-sm text-muted">Signed in as <span className="font-mono text-fg">{session.actor?.username}</span>.</p>
          <Button
            variant="secondary"
            icon={LogOut}
            className="mt-4"
            onClick={() => {
               void logout().then(() => {
                 client.removeQueries({ predicate: (query) => query.queryKey[0] === 'real' && !['session', 'bootstrap'].includes(String(query.queryKey[1])) })
                 return client.invalidateQueries({ queryKey: SESSION_KEY })
               })
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    )
  }
  return <LoginForm onDone={() => void client.invalidateQueries({ queryKey: SESSION_KEY })} />
}
