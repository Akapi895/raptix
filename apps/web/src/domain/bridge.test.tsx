/**
 * Ticket 04 bridge acceptance: one seeded database behind the atomic
 * transaction/subscription bridge, service↔legacy observation in both
 * directions, factory context injection (actor/project/clock) with read
 * cancellation and deadline/sweep scheduling, and deterministic demo reset
 * (run twice). See execution.md "One data authority during migration".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { seed } from '../demo/seed';
import { type Project, type Role } from './entities'
import { mountServices } from '../test/helpers'
import { resetDemo, terminateSession } from '../features/demo/runtime'
import { changeAssetScopeTransaction } from '../features/assets/writes'
import { DEMO_ANCHOR, formatDemoInstant, parseDemoInstant } from './clock'
import { createConsoleServices } from './service-factory'
import type { ActorRef, ChangeSet, RequestContext, ServiceResult } from './service'

afterEach(() => { cleanup(); vi.useRealTimers() })

let corrSeq = 0
const actor = (id: string, role: Role): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId: string): RequestContext => ({ actor: a, projectId, corr: `corr-${++corrSeq}` })

/** Mounts the canonical lifecycle for transaction and reset integration. */
function mountBridge(me = 'Alex Morgan') {
  return mountServices(null, me)
}

describe('clock: demo anchor, absolute instants, expiry normalization', () => {
  it('anchors at the dataset demo date and formats display strings in the project timezone', () => {
    const svc = createConsoleServices()
    expect(svc.clock.now()).toBe(DEMO_ANCHOR)
    expect(formatDemoInstant(svc.clock.now())).toBe('Oct 13, 2026, 10:42 AM (UTC+7)')
    svc.dispose()
  })

  it('advances elapsed time as absolute instants, including date rollover', () => {
    const svc = createConsoleServices()
    svc.clock.advance(90 * 60_000)
    expect(formatDemoInstant(svc.clock.now())).toBe('Oct 13, 2026, 12:12 PM (UTC+7)')
    svc.clock.advance(24 * 60 * 60_000)
    expect(formatDemoInstant(svc.clock.now())).toBe('Oct 14, 2026, 12:12 PM (UTC+7)')
    svc.clock.reset()
    expect(svc.clock.now()).toBe(DEMO_ANCHOR)
    svc.dispose()
  })

  it('normalizes seeded expiry strings into absolute instants at the service boundary', () => {
    expect(parseDemoInstant('Oct 13, 2026, 11:15 AM (UTC+7)')).toBe(Date.parse('2026-10-13T11:15:00+07:00'))
    expect(parseDemoInstant('Oct 14, 2026, 9:25 AM (UTC+7)')).toBe(Date.parse('2026-10-14T09:25:00+07:00'))
    expect(parseDemoInstant('Oct 13, 2026, 12:05 PM (UTC+7)')).toBe(Date.parse('2026-10-13T12:05:00+07:00'))
    expect(parseDemoInstant('—')).toBeUndefined()
    expect(parseDemoInstant('Aug 30, 2028')).toBeUndefined()
  })

  it('schedules deadline events at parsed seeded expiry instants without any screen mounted', () => {
    const svc = createConsoleServices()
    const plan = svc.authority.snapshot().plans.find((p) => p.expires)!
    const deadline = parseDemoInstant(plan.expires!)!
    expect(deadline).toBeGreaterThan(svc.clock.now())
    let fired = 0
    svc.schedule(deadline, () => { fired++ })
    svc.clock.advance(deadline - svc.clock.now())
    expect(fired).toBe(1)
    expect(formatDemoInstant(svc.clock.now())).toBe('Oct 14, 2026, 9:25 AM (UTC+7)')
    svc.dispose()
  })

  it('runs recurring sweeps on clock time; cancel stops a sweep and reset disposes one', () => {
    const svc = createConsoleServices()
    let ticks = 0
    const cancel = svc.sweep(15_000, () => { ticks++ })
    svc.clock.advance(45_000)
    expect(ticks).toBe(3)
    cancel()
    svc.clock.advance(45_000)
    expect(ticks).toBe(3)
    const svc2 = createConsoleServices()
    svc2.sweep(15_000, () => { ticks++ })
    svc2.reset()
    svc2.clock.advance(60_000)
    expect(ticks).toBe(3)
    svc.dispose(); svc2.dispose()
  })
})

describe('authority: one seed, atomic commits, published identities', () => {
  it('commits atomically and publishes the affected identities to subscribers', () => {
    const svc = createConsoleServices()
    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    const cs = svc.authority.commit('corr-1', (d) => { d.projects.find((p) => p.id === 'RT-2026-014')!.pinned = false })
    expect(seen).toEqual([cs])
    expect(cs.entities).toContainEqual({ kind: 'project', id: 'RT-2026-014', projectId: 'RT-2026-014' })
    expect(cs.projectId).toBe('RT-2026-014')
    expect(cs.at).toBe(svc.clock.now())
    expect(cs.corr).toBe('corr-1')
    expect(svc.authority.snapshot().projects.find((p) => p.id === 'RT-2026-014')!.pinned).toBe(false)
    svc.dispose()
  })

  it('reset is deterministic when repeated and notifies each subscriber once per reset', () => {
    const svc = createConsoleServices()
    let calls = 0
    svc.subscribe(() => { calls++ })
    svc.authority.commit('dirty', (d) => { d.notices.shift() })
    const cs1 = svc.authority.reset()
    const snap1 = JSON.stringify(svc.authority.snapshot())
    const cs2 = svc.authority.reset('e2e01')
    const snap2 = JSON.stringify(svc.authority.snapshot())
    expect(calls).toBe(3)
    expect(cs1.corr).toBe('reset')
    expect(cs2.corr).toBe('reset')
    expect(snap1).toBe(JSON.stringify(seed()))
    expect(snap2).toBe(JSON.stringify(seed('e2e01')))
    svc.dispose()
  })
})

describe('canonical services and authority integration', () => {
  it('a service mutation is visible in a subsequent scoped read', async () => {
    const view = mountBridge()
    const svc = view.svc()
    expect(view.db().projects.find((p) => p.id === 'RT-2026-014')!.pinned).toBe(true)
    let res!: ServiceResult<Project>
    await act(async () => { res = await svc.forScope(actor('Alex Morgan', 'manager'), 'RT-2026-014')
      .update(ctxOf(actor('Alex Morgan', 'manager'), 'RT-2026-014'), 'RT-2026-014', { pinned: false }) })
    expect(res.ok).toBe(true)
    expect(view.db().projects.find((p) => p.id === 'RT-2026-014')!.pinned).toBe(false)
    const read = await svc.forScope(actor('Alex Morgan', 'manager'), 'RT-2026-014').get(ctxOf(actor('Alex Morgan', 'manager'), 'RT-2026-014'), 'RT-2026-014')
    expect(read.ok && read.data.pinned).toBe(false)
    view.unmount()
  })

  it('an asset transaction publishes coherent identities, counters and audited scope', () => {
    const view = mountBridge()
    const seen: ChangeSet[] = []
    const stop = view.svc().subscribe((cs) => seen.push(cs))
    const auditBefore = view.db().counters.audit
    // Ticket 51: the delegated scope change commits the flip and its audit in
    // ONE ChangeSet (the transaction owns the atomicity). Ticket 65 retired
    // the zero-caller A.setAssetScope wrapper; the legacy-context entry is
    // the same transaction the wrapper forwarded to (corr 'legacy').
    view.run(() => { changeAssetScopeTransaction(view.svc().authority, view.svc().clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: '', corr: 'legacy' }, 'AS-0141', 'out') })
    expect(seen.map((cs) => cs.corr)).toEqual(['legacy'])
    expect(seen[0].entities).toContainEqual({ kind: 'asset', id: 'AS-0141', projectId: 'RT-2026-014' })
    expect(seen[0].entities.some((e) => e.kind === 'audit')).toBe(true)
    expect(view.db().counters.audit).toBe(auditBefore + 1)
    expect(view.db().assets.find((a) => a.id === 'AS-0141')?.scope).toBe('out')
    stop()
    view.unmount()
  })

  it('typed reads are scope-checked: members read, out-of-scope ids stay not-found', async () => {
    const svc = createConsoleServices()
    const viewer = actor('Casey Nguyen (Client)', 'viewer')
    const member = await svc.forScope(viewer, 'RT-2026-014').get(ctxOf(viewer, 'RT-2026-014'), 'RT-2026-014')
    expect(member.ok && member.data.id).toBe('RT-2026-014')
    const foreign = await svc.forScope(viewer, 'RT-2026-015').get(ctxOf(viewer, 'RT-2026-015'), 'RT-2026-015')
    expect(foreign).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    const missing = await svc.forScope(actor('Alex Morgan', 'manager'), '').get(ctxOf(actor('Alex Morgan', 'manager'), ''), 'RT-9999')
    expect(missing).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    svc.dispose()
  })

  it('typed list honors the request-context project and pagination', async () => {
    const svc = createConsoleServices()
    const mgr = actor('Alex Morgan', 'manager')
    const all = await svc.forScope(mgr, '').list(ctxOf(mgr, ''), { page: 1, pageSize: 2 })
    expect(all.ok && all.data.items).toHaveLength(2)
    expect(all.ok && all.data.total).toBe(6)
    const scoped = await svc.forScope(mgr, 'RT-2026-015').list(ctxOf(mgr, 'RT-2026-015'))
    expect(scoped.ok && scoped.data.items.map((p) => p.id)).toEqual(['RT-2026-015'])
    svc.dispose()
  })

  it('the typed write refuses unauthorized actors without committing', async () => {
    const view = mountBridge('Casey Nguyen (Client)')
    const seen: ChangeSet[] = []
    view.svc().subscribe((cs) => seen.push(cs))
    const casey = actor('Casey Nguyen (Client)', 'viewer')
    let res!: ServiceResult<Project>
    await act(async () => { res = await view.svc().forScope(casey, 'RT-2026-014')
      .update(ctxOf(casey, 'RT-2026-014'), 'RT-2026-014', { pinned: true }) })
    expect(res).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    expect(seen).toEqual([])
    expect(view.db().projects.find((p) => p.id === 'RT-2026-014')!.pinned).toBe(true)
    view.unmount()
  })

  it('cancelling a scope resolves in-flight reads as unavailable instead of restoring stale visibility', async () => {
    const svc = createConsoleServices()
    const mgr = actor('Alex Morgan', 'manager')
    let pending!: Promise<ServiceResult<Project>>
    act(() => {
      pending = svc.forScope(mgr, 'RT-2026-014').get(ctxOf(mgr, 'RT-2026-014'), 'RT-2026-014')
      svc.cancelScope(mgr, 'RT-2026-014')
    })
    const cancelled = await pending
    expect(cancelled).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'unavailable' }) })
    const fresh = await svc.forScope(mgr, 'RT-2026-014').get(ctxOf(mgr, 'RT-2026-014'), 'RT-2026-014')
    expect(fresh.ok).toBe(true)
    svc.dispose()
  })

  it('factory injection binds the request context at call time; the write stamps clock time', async () => {
    const svc = createConsoleServices()
    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    const alex = actor('Alex Morgan', 'manager')
    const req = ctxOf(alex, 'RT-2026-014')
    let res!: ServiceResult<Project>
    await act(async () => { res = await svc.forScope(alex, 'RT-2026-014')
      .update(req, 'RT-2026-014', { desc: 'Updated via the service boundary.' }) })
    expect(res.ok).toBe(true)
    expect(seen[0].corr).toBe(req.corr)
    expect(seen[0].entities).toContainEqual({ kind: 'project', id: 'RT-2026-014', projectId: 'RT-2026-014' })
    const p = svc.authority.snapshot().projects.find((x) => x.id === 'RT-2026-014')!
    expect(p.desc).toBe('Updated via the service boundary.')
    expect(p.updated).toBe(formatDemoInstant(svc.clock.now()))
    svc.dispose()
  })

  it('demo reset replaces the one dataset, disposes pending callbacks and is deterministic when repeated', () => {
    const view = mountBridge()
    const svc = view.svc()
    let resets = 0
    let fired = 0
    const stop = svc.subscribe((cs) => { if (cs.corr === 'reset') resets++ })
    svc.schedule(svc.clock.now() + 5_000, () => { fired++ })
    view.run(() => { resetDemo() })
    view.run(() => { resetDemo('e2e01') })
    expect(resets).toBe(2)
    expect(view.db().projects.map((p) => p.id)).toEqual(seed('e2e01').projects.map((p) => p.id))
    expect(JSON.stringify(svc.authority.snapshot())).toBe(JSON.stringify(seed('e2e01')))
    view.run(() => { resetDemo() })
    expect(JSON.stringify(svc.authority.snapshot())).toBe(JSON.stringify(seed()))
    svc.clock.advance(60_000)
    expect(fired).toBe(0)
    expect(svc.clock.now()).toBe(DEMO_ANCHOR + 60_000)
    stop()
    view.unmount()
  })

  it('repeated demo reset disposes pending dataset-bound session timers', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = mountBridge()
    view.run(() => { terminateSession('SS-041', 'demo') })
    expect(view.db().sessions.find((s) => s.id === 'SS-041')!.state).toBe('revoking')
    view.run(() => { resetDemo() })
    view.run(() => { resetDemo() })
    act(() => { vi.advanceTimersByTime(5_000) })
    const s = view.db().sessions.find((x) => x.id === 'SS-041')!
    expect(s.state).toBe('connected')
    expect(s.grants.map((g) => g.user)).toEqual(['Taylor Chen'])
    view.unmount()
  })
})
