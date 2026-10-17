/**
 * The mock membership adapter reads the owner and the project members, and
 * writes role changes, invites and removals through the atomic membership
 * transaction. A reviewer, who cannot edit scope, cannot manage members.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import type { ActorRef, RequestContext } from '../../domain/service'

afterEach(cleanup)

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const P14 = 'RT-2026-014'

let corrSeq = 0
const ctxOf = (actor: ActorRef): RequestContext => ({ actor, projectId: P14, corr: `team-mock-${++corrSeq}` })

describe('mock membership adapter', () => {
  it('reads the owner and the project members, and lets a manager assign the mock roles', async () => {
    const h = mountServices(undefined, 'Alex Morgan')
    const team = h.svc().team(ALEX, P14)
    const read = await team.read(ctxOf(ALEX))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.members[0]).toMatchObject({ owner: true, role: 'owner' })
    expect(read.data.canManage).toBe(true)
    expect(read.data.assignableRoles).toContain('reviewer')
    expect(read.data.invite.candidates.length).toBeGreaterThan(0)
  })

  it('invites a candidate, changes the role, and removes the member; the audit row follows each write', async () => {
    const h = mountServices(undefined, 'Alex Morgan')
    const team = h.svc().team(ALEX, P14)
    const first = await team.read(ctxOf(ALEX))
    if (!first.ok) throw new Error(first.failure.message)
    const candidate = first.data.invite.candidates[0]!

    const invited = await team.invite(ctxOf(ALEX), { username: candidate, displayName: candidate, role: 'reviewer', password: '' })
    expect(invited).toMatchObject({ ok: true, data: { id: candidate, role: 'reviewer' } })

    const changed = await team.changeRole(ctxOf(ALEX), candidate, 'analyst')
    expect(changed).toMatchObject({ ok: true, data: { id: candidate, role: 'analyst' } })

    const removed = await team.remove(ctxOf(ALEX), candidate)
    expect(removed).toMatchObject({ ok: true, data: null })
    const after = await team.read(ctxOf(ALEX))
    if (after.ok) expect(after.data.members.some((m) => m.id === candidate)).toBe(false)
    expect(h.svc().authority.snapshot().audit.filter((a) => a.obj === candidate).map((a) => a.action)).toEqual(expect.arrayContaining([expect.stringContaining('Removed'), expect.stringContaining('Analyst')]))
  })

  it('tells a reviewer why members cannot be managed', async () => {
    const h = mountServices(undefined, 'Pat Kim')
    const read = await h.svc().team(PAT, P14).read(ctxOf(PAT))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.canManage).toBe(false)
    expect(read.data.manageReason).toBe('Only a Red Team Manager or Organization Admin can manage members.')
  })
})
