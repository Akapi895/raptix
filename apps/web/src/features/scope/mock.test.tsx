/**
 * The mock scope adapter presents approval records as scope revisions: a
 * submitted revision is pending, the requester cannot decide it, a reviewer's
 * approval supersedes the previous approved version, and a rejection needs a
 * reason because the approval records require one.
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
const ctxOf = (actor: ActorRef): RequestContext => ({ actor, projectId: P14, corr: `scope-mock-${++corrSeq}` })

const DIFF = { added: ['10.0.0.9'], removed: [], rationale: 'Add the probe host.' }
const ROE = { windows: [], emergencyContacts: [], restrictions: [] }

describe('mock scope adapter', () => {
  it('submits a pending revision, refuses the requester\'s own decision, and supersedes on approval', async () => {
    const h = mountServices(undefined, 'Alex Morgan')
    const scope = h.svc().scope(ALEX, P14)
    const before = await scope.read(ctxOf(ALEX))
    expect(before.ok).toBe(true)
    if (!before.ok) return

    const submitted = await scope.submit(ctxOf(ALEX), { diff: DIFF, roe: ROE })
    expect(submitted).toMatchObject({ ok: true, data: { status: 'pending', requestedBy: 'Alex Morgan', diff: { rationale: 'Add the probe host.' } } })
    if (!submitted.ok) return

    const refused = await scope.decide(ctxOf(ALEX), submitted.data.id, 'approved')
    expect(refused.ok).toBe(false)

    const approved = await scope.decide(ctxOf(PAT), submitted.data.id, 'approved')
    expect(approved).toMatchObject({ ok: true, data: { status: 'approved', decidedBy: 'Pat Kim' } })

    const after = await scope.read(ctxOf(PAT))
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect(after.data.latestApprovedVersion).toBe(submitted.data.version)
    expect(after.data.revisions.find((r) => r.id === submitted.data.id)?.status).toBe('approved')
    expect(after.data.supports.roeFields).toBe(false)
    expect(after.data.unmodelled).toEqual([])
  })

  it('refuses a rejection without a reason and records a rejected revision with one', async () => {
    const h = mountServices(undefined, 'Alex Morgan')
    const scope = h.svc().scope(ALEX, P14)
    const submitted = await scope.submit(ctxOf(ALEX), { diff: { added: ['10.0.0.10'], removed: [], rationale: 'Second probe host.' }, roe: ROE })
    if (!submitted.ok) throw new Error(submitted.failure.message)

    const noReason = await scope.decide(ctxOf(PAT), submitted.data.id, 'rejected')
    expect(noReason.ok).toBe(false)

    const rejected = await scope.decide(ctxOf(PAT), submitted.data.id, 'rejected', 'Address the reviewer note first.')
    expect(rejected).toMatchObject({ ok: true, data: { status: 'rejected' } })
  })
})
