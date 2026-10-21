import { apiFetch, ApiTransportError, setCsrfToken } from './transport';

/** Response of GET /api/auth/session (multi-user deployments; local 404s). */
export interface AuthSessionView {
  authenticated: boolean
  actor?: { id: string; username: string; displayName: string }
  csrfToken?: string
  mode: 'multi-user'
}

export function isAuthSessionView(v: unknown): v is AuthSessionView {
  return typeof v === 'object' && v !== null && typeof (v as AuthSessionView).authenticated === 'boolean'
    && (v as AuthSessionView).mode === 'multi-user'
}

/**
 * Resolves the trusted session. A 404 (or any failure that says the route is
 * absent) means the server runs the local single-user identity — the caller
 * falls back to REAL_IDENTITY instead of inventing a session.
 */
export async function fetchAuthSession(): Promise<AuthSessionView | null> {
  try {
    const session = await apiFetch('/auth/session', isAuthSessionView)
    setCsrfToken(session.authenticated ? session.csrfToken ?? null : null)
    return session
  } catch (error) {
    setCsrfToken(null)
    if (error instanceof ApiTransportError && error.status === 404) return null
    throw error
  }
}

export interface LoginInput { username: string; password: string }

export function announceSessionChange(): void {
  try { localStorage.setItem('raptix.session-change', crypto.randomUUID()) } catch { /* focus revalidation also covers unavailable storage */ }
  window.dispatchEvent(new Event('raptix:session-change'))
}

export async function login(input: LoginInput): Promise<AuthSessionView> {
  const view = await apiFetch('/auth/login', isAuthSessionView, { method: 'POST', body: input })
  setCsrfToken(view.csrfToken ?? null)
  announceSessionChange()
  return view
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', (v): v is { authenticated: boolean } => typeof v === 'object' && v !== null && typeof (v as { authenticated: unknown }).authenticated === 'boolean', { method: 'POST' })
    announceSessionChange()
  } finally {
    setCsrfToken(null)
  }
}
