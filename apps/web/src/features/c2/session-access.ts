/**
 * The derived facts of one C2 session as the sessions workspace shows them: the connection, the actor's own access, and the
 * filters over the session list. Connection and access stay apart: a connected session is not an authorization, and losing
 * access never turns a live connection into a disconnected one. Pure, so each rule is checked without rendering.
 */
import type { Asset } from '../../domain/entities'
import type { C2ProviderGrant, C2ProviderSession } from './provider'

export type ConnectionState = 'alive' | 'dead'

export function connectionOf(session: C2ProviderSession): ConnectionState {
  return session.isDead ? 'dead' : 'alive'
}

export type AccessKey = 'approved' | 'requested' | 'expired' | 'rejected' | 'revoked' | 'none'

export interface MyAccess {
  key: AccessKey
  label: string
  /** The absolute instant the grant ends, when the actor holds one. */
  until: string | null
}

const STATUS_PRIORITY: Readonly<Record<C2ProviderGrant['status'], number>> = { approved: 0, requested: 1, expired: 2, revoked: 3, rejected: 4 }

/**
 * The actor's access to one session, from the grants the provider reports. An approved grant past its deadline is expired,
 * whatever status the record still carries; a requested grant waits for a reviewer.
 */
export function myAccessOf(grants: readonly C2ProviderGrant[], sessionId: string, actorId: string, now: number): MyAccess {
  const mine = grants
    .filter((grant) => grant.sessionId === sessionId && grant.actorId === actorId)
    .sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || Date.parse(b.expiresAt) - Date.parse(a.expiresAt))
  const grant = mine[0]
  if (grant === undefined) return { key: 'none', label: 'No grant — request access', until: null }
  if (grant.status === 'approved') {
    if (Date.parse(grant.expiresAt) > now) return { key: 'approved', label: `Approved until ${grant.expiresAt.replace('T', ' ').slice(0, 16)} UTC`, until: grant.expiresAt }
    return { key: 'expired', label: 'Expired — request access again', until: grant.expiresAt }
  }
  if (grant.status === 'requested') return { key: 'requested', label: 'Requested — waiting for a reviewer', until: null }
  if (grant.status === 'rejected') return { key: 'rejected', label: 'Request rejected', until: null }
  if (grant.status === 'revoked') return { key: 'revoked', label: 'Revoked', until: null }
  return { key: 'expired', label: 'Expired — request access again', until: grant.expiresAt }
}

export type KindFilter = 'all' | 'c2' | 'webshell'
export type StateFilter = 'all' | ConnectionState

/**
 * The session list's filters. The provider reports only C2 sessions, so a WebShell filter matches none until a WebShell
 * provider is registered and reports its own sessions.
 */
export function filterSessions(
  sessions: readonly C2ProviderSession[],
  filters: { kind: KindFilter; state: StateFilter; query: string },
): C2ProviderSession[] {
  const needle = filters.query.trim().toLowerCase()
  return sessions.filter((session) => {
    if (filters.kind === 'webshell') return false
    if (filters.state !== 'all' && connectionOf(session) !== filters.state) return false
    if (needle === '') return true
    return [session.id, session.hostname, session.username, session.activeC2, session.transport].some((field) => field.toLowerCase().includes(needle))
  })
}

/** How a session's host was matched to an inventory asset. The provider reports a host name and an address, not an asset id. */
export type AssetMatchBy = 'host name' | 'address'

export type AssetLink =
  | { status: 'linked'; asset: Asset; by: AssetMatchBy }
  | { status: 'ambiguous'; count: number }
  | { status: 'none' }

/**
 * The inventory asset a session's host corresponds to. A host name match wins; an address match is used only when no name
 * matches. More than one candidate is never linked: the operator sees how many match and decides.
 */
export function assetLinkOf(session: C2ProviderSession, assets: readonly Asset[]): AssetLink {
  const host = session.hostname.trim().toLowerCase()
  const byName = assets.filter((asset) => asset.name.trim().toLowerCase() === host || asset.ident.trim().toLowerCase() === host)
  const candidates: { asset: Asset; by: AssetMatchBy }[] = byName.length > 0
    ? byName.map((asset) => ({ asset, by: 'host name' }))
    : assets.filter((asset) => asset.ip !== '' && asset.ip === session.remoteAddress).map((asset) => ({ asset, by: 'address' }))
  if (candidates.length === 0) return { status: 'none' }
  if (candidates.length > 1) return { status: 'ambiguous', count: candidates.length }
  return { status: 'linked', asset: candidates[0]!.asset, by: candidates[0]!.by }
}
