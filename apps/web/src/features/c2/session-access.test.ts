/**
 * The sessions workspace's facts: a connected session stays connected when the actor's grant has run out, the actor's access
 * is read from the grants that belong to that session and that actor, and a WebShell filter matches no C2 session.
 */
import { describe, expect, it } from 'vitest'
import type { Asset } from '../../domain/entities'
import type { C2ProviderGrant, C2ProviderSession } from './provider'
import { assetLinkOf, connectionOf, filterSessions, myAccessOf } from './session-access'

const NOW = Date.parse('2026-10-23T10:00:00.000Z')

function session(overrides: Partial<C2ProviderSession>): C2ProviderSession {
  return {
    id: 'sess-1', hostname: 'win-dc-01', username: 'svc', os: 'windows', arch: 'amd64', transport: 'mtls', activeC2: 'sliver',
    remoteAddress: '10.0.0.5', listenerPort: 8443, lastCheckin: '2026-10-23T09:59:00.000Z', isDead: false, ...overrides,
  }
}

function grant(overrides: Partial<C2ProviderGrant>): C2ProviderGrant {
  return { id: 'g-1', sessionId: 'sess-1', status: 'approved', reason: 'scope check', actorId: 'u-operator', reviewerId: 'u-reviewer', expiresAt: '2026-10-23T12:00:00.000Z', ...overrides }
}

describe('connection and access stay apart', () => {
  it('keeps a live session connected after the actor grant has run out', () => {
    const live = session({ isDead: false })
    const expired = myAccessOf([grant({ expiresAt: '2026-10-23T09:00:00.000Z' })], 'sess-1', 'u-operator', NOW)
    expect(connectionOf(live)).toBe('alive')
    expect(expired.key).toBe('expired')
  })

  it('reads an approved grant past its deadline as expired, whatever status the record carries', () => {
    expect(myAccessOf([grant({ expiresAt: '2026-10-23T09:00:00.000Z' })], 'sess-1', 'u-operator', NOW).key).toBe('expired')
  })

  it('shows an approved grant that is still inside its deadline with the instant it ends', () => {
    const access = myAccessOf([grant({ expiresAt: '2026-10-23T12:00:00.000Z' })], 'sess-1', 'u-operator', NOW)
    expect(access).toMatchObject({ key: 'approved', until: '2026-10-23T12:00:00.000Z' })
  })

  it('reads only the grants of this session and this actor', () => {
    const grants = [grant({ sessionId: 'sess-2' }), grant({ actorId: 'u-other' })]
    expect(myAccessOf(grants, 'sess-1', 'u-operator', NOW).key).toBe('none')
  })

  it('reports a requested grant as waiting for a reviewer, not as access', () => {
    expect(myAccessOf([grant({ status: 'requested', expiresAt: '2026-10-23T12:00:00.000Z' })], 'sess-1', 'u-operator', NOW).key).toBe('requested')
  })

  it('prefers an approved grant over an older rejected one for the same session', () => {
    const access = myAccessOf([grant({ status: 'rejected', expiresAt: '2026-10-23T13:00:00.000Z' }), grant({ id: 'g-2', status: 'approved', expiresAt: '2026-10-23T12:00:00.000Z' })], 'sess-1', 'u-operator', NOW)
    expect(access.key).toBe('approved')
  })
})

describe('session filters', () => {
  const sessions = [session({ id: 'sess-1' }), session({ id: 'sess-2', hostname: 'linux-web-02', isDead: true })]

  it('filters by connection and by search over identity and channel fields', () => {
    expect(filterSessions(sessions, { kind: 'all', state: 'dead', query: '' }).map((s) => s.id)).toEqual(['sess-2'])
    expect(filterSessions(sessions, { kind: 'all', state: 'all', query: 'SLIVER' }).map((s) => s.id)).toEqual(['sess-1', 'sess-2'])
    expect(filterSessions(sessions, { kind: 'all', state: 'all', query: 'linux' }).map((s) => s.id)).toEqual(['sess-2'])
  })

  it('matches no C2 session under the WebShell filter, since no WebShell provider reports sessions', () => {
    expect(filterSessions(sessions, { kind: 'webshell', state: 'all', query: '' })).toEqual([])
  })
})

describe('session to asset link', () => {
  function asset(overrides: Partial<Asset>): Asset {
    return { id: 'a-1', name: 'win-dc-01', ident: 'win-dc-01.lab', ip: '10.0.0.9', type: 'Host', os: '', owner: '', projectId: 'eng-1', scope: 'in', source: 'managed', updated: '2026-10-20T09:00:00.000Z', observation: null, ...overrides }
  }

  it('links the one asset whose name or identifier matches the host, and says the match was by host name', () => {
    const link = assetLinkOf(session({ hostname: 'WIN-DC-01' }), [asset({}), asset({ id: 'a-2', name: 'web-02', ident: 'web-02', ip: '10.0.0.20' })])
    expect(link).toMatchObject({ status: 'linked', by: 'host name', asset: { id: 'a-1' } })
  })

  it('falls back to the address only when no name matches', () => {
    const link = assetLinkOf(session({ hostname: 'unknown-box', remoteAddress: '10.0.0.9' }), [asset({})])
    expect(link).toMatchObject({ status: 'linked', by: 'address', asset: { id: 'a-1' } })
  })

  it('links nothing when no name or address matches', () => {
    expect(assetLinkOf(session({ hostname: 'unknown-box', remoteAddress: '192.168.1.1' }), [asset({})])).toEqual({ status: 'none' })
  })

  it('never links an ambiguous match, and reports how many assets match', () => {
    const link = assetLinkOf(session({ hostname: 'win-dc-01' }), [asset({}), asset({ id: 'a-3', ident: 'win-dc-01' })])
    expect(link).toEqual({ status: 'ambiguous', count: 2 })
  })
})
