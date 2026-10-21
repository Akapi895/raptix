import { describe, expect, it } from 'vitest'
import { formatDemoInstant, MockClock } from '../../domain/clock'
import { createDatabaseAuthority } from '../../demo/authority'
import type { ActorRef, RequestContext } from '../../domain/service'
import { listFindings, setFindingSuggestionDisposition } from './service'

const taylor: ActorRef = { id: 'Taylor Chen', role: 'operator' }
const alex: ActorRef = { id: 'Alex Morgan', role: 'manager' }
// Riley Brooks is a member of RT-2026-014 only, with the analyst role.
const riley: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
// Reviewers are elevated (they see every project) but cannot create findings.
const reviewer: ActorRef = { id: 'Sam Reviewer', role: 'reviewer' }
const ctxOf = (actor: ActorRef, projectId: string): RequestContext => ({ actor, projectId, corr: 'suggestion-disposition' })
const dismissal = { producerRef: '', dismissed: true, reason: 'Covered by FD-011', expectedVersion: 0 }
const restoration = { producerRef: '', dismissed: false, reason: '', expectedVersion: 1 }

function harness() {
  const clock = new MockClock()
  return { clock, authority: createDatabaseAuthority(clock) }
}

describe('mock suggestion disposition', () => {
  it('stores a dismissal for the acting user only, with an audit row and no comment on the finding', () => {
    const h = harness()
    const commentsBefore = h.authority.snapshot().findings.find((x) => x.id === 'FD-012')!.comments
    const result = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', dismissal)
    const at = formatDemoInstant(h.clock.now())

    expect(result).toEqual({ ok: true, data: { producerRef: '', dismissed: true, reason: 'Covered by FD-011', version: 1 } })
    const db = h.authority.snapshot()
    const finding = db.findings.find((x) => x.id === 'FD-012')!
    expect(finding.comments).toEqual(commentsBefore)
    expect(finding.suggestionDispositions).toEqual({ 'Taylor Chen': { dismissed: true, reason: 'Covered by FD-011', version: 1 } })
    expect(db.audit[0]).toMatchObject({ action: 'Dismissed AI suggestion', obj: 'FD-012', projectId: 'RT-2026-014', result: 'Success', reason: 'Covered by FD-011', actor: 'Taylor Chen', at })
  })

  it('advances the injected clock, so a restore is audited at the new time and bumps the version', () => {
    const h = harness()
    setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', dismissal)
    const dismissedAt = formatDemoInstant(h.clock.now())
    h.clock.advance(60 * 60 * 1000)
    const result = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', restoration)
    const restoredAt = formatDemoInstant(h.clock.now())

    expect(restoredAt).not.toBe(dismissedAt)
    expect(result).toEqual({ ok: true, data: { producerRef: '', dismissed: false, reason: null, version: 2 } })
    const db = h.authority.snapshot()
    expect(db.audit[0]).toMatchObject({ action: 'Restored AI suggestion', obj: 'FD-012', result: 'Success', at: restoredAt })
    expect(db.audit[1]).toMatchObject({ action: 'Dismissed AI suggestion', at: dismissedAt })
    expect(db.findings.find((x) => x.id === 'FD-012')!.suggestionDispositions).toEqual({ 'Taylor Chen': { dismissed: false, reason: null, version: 2 } })
  })

  it('replays a repeated dismissal with the stored version and writes no second audit row', () => {
    const h = harness()
    setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', dismissal)
    const auditRows = h.authority.snapshot().audit.length
    const result = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', dismissal)

    expect(result).toEqual({ ok: true, data: { producerRef: '', dismissed: true, reason: 'Covered by FD-011', version: 1 } })
    expect(h.authority.snapshot().audit.length).toBe(auditRows)
  })

  it('refuses a stale expectedVersion for a dismissal or a restore, and leaves the stored state unchanged', () => {
    const h = harness()
    setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', dismissal)
    const auditRows = h.authority.snapshot().audit.length
    const staleRestore = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', { ...restoration, expectedVersion: 0 })
    const staleDismissal = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', { ...dismissal, reason: 'Different reason', expectedVersion: 0 })

    expect(staleRestore).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict' }) })
    expect(staleDismissal).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict' }) })
    const db = h.authority.snapshot()
    expect(db.findings.find((x) => x.id === 'FD-012')!.suggestionDispositions).toEqual({ 'Taylor Chen': { dismissed: true, reason: 'Covered by FD-011', version: 1 } })
    expect(db.audit.length).toBe(auditRows)
  })

  it('refuses a dismissal without a reason, including a blank one', () => {
    const h = harness()
    for (const reason of ['', '   ']) {
      const result = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', { ...dismissal, reason })
      expect(result).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation' }) })
    }
    expect(h.authority.snapshot().findings.find((x) => x.id === 'FD-012')!.suggestionDispositions).toBeUndefined()
  })

  it('refuses a dismissal and a restore from a role that cannot create findings', () => {
    const h = harness()
    const denied = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(reviewer, 'RT-2026-014'), 'FD-012', dismissal)
    expect(denied).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    const restore = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(reviewer, 'RT-2026-014'), 'FD-012', { ...restoration, expectedVersion: 0 })
    expect(restore).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    expect(h.authority.snapshot().findings.find((x) => x.id === 'FD-012')!.suggestionDispositions).toBeUndefined()
  })

  it('refuses a dismissal on a closed project as read-only', () => {
    const h = harness()
    h.authority.commit('close-project', (d) => { d.projects.find((p) => p.id === 'RT-2026-014')!.status = 'closed' })
    const result = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', dismissal)
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('read-only') }) })
  })

  it('refuses a dismissal for a finding in a project the actor cannot access', () => {
    const h = harness()
    const commentsBefore = h.authority.snapshot().findings.find((x) => x.id === 'FD-015')!.comments
    const result = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(riley, 'RT-2026-015'), 'FD-015', { ...dismissal, reason: 'Out of scope' })

    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(h.authority.snapshot().findings.find((x) => x.id === 'FD-015')!.comments).toEqual(commentsBefore)
  })

  it('refuses a restore for a finding in a project the actor cannot access, and writes no audit row', () => {
    const h = harness()
    const auditRows = h.authority.snapshot().audit.length
    const result = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(riley, 'RT-2026-015'), 'FD-015', { ...restoration, expectedVersion: 0 })

    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(h.authority.snapshot().audit.length).toBe(auditRows)
  })

  it('refuses dismiss and restore outside the active project even when the actor can access both projects', () => {
    const h = harness()
    const auditRows = h.authority.snapshot().audit.length
    for (const input of [dismissal, { ...restoration, expectedVersion: 0 }]) {
      const result = setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(alex, 'RT-2026-015'), 'FD-012', input)
      expect(result).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    }
    expect(h.authority.snapshot().audit.length).toBe(auditRows)
    expect(h.authority.snapshot().findings.find((x) => x.id === 'FD-012')!.suggestionDispositions).toBeUndefined()
  })

  it('hides a dismissed suggestion only for the user who dismissed it', () => {
    const h = harness()
    const ai = (actor: ActorRef) => {
      const res = listFindings(h.authority.snapshot(), ctxOf(actor, 'RT-2026-014'))
      if (!res.ok) throw new Error(res.failure.message)
      return res.data
    }
    const before = { taylor: ai(taylor), alex: ai(alex) }
    setFindingSuggestionDisposition(h.authority, h.clock, ctxOf(taylor, 'RT-2026-014'), 'FD-012', dismissal)
    const after = { taylor: ai(taylor), alex: ai(alex) }

    expect(after.taylor.counts.ai).toBe(before.taylor.counts.ai - 1)
    expect(after.taylor.dismissedCount).toBe(1)
    expect(after.alex.counts.ai).toBe(before.alex.counts.ai)
    expect(after.alex.dismissedCount).toBe(0)
  })
})
