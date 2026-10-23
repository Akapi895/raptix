import { describe, expect, it } from 'vitest'
import { createConsoleServices } from '../../demo/services'
import { projectAccessible } from '../../domain/policy'
import type { ActorRef } from '../../domain/service'
import { createOverviewService } from './mock'

const owner: ActorRef = { id: 'Alex Morgan', role: 'manager' }

describe('demo overview port', () => {
  it('counts only verified findings and never the AI suggestions', async () => {
    const svc = createConsoleServices()
    const db = svc.authority.snapshot()
    const accessible = new Set(db.projects.filter((p) => projectAccessible(p, owner)).map((p) => p.id))
    const verified = db.findings.filter((f) => accessible.has(f.projectId) && f.status !== 'ai_suggested')
    const res = await createOverviewService(svc.authority, owner).findings()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.total).toBe(verified.length)
    expect(res.data.byStatus.ai_suggested).toBeUndefined()
    expect(res.data.engagements).toBe(accessible.size)
  })

  it('answers the command audit as not recorded instead of inventing a command count', async () => {
    const svc = createConsoleServices()
    const res = await createOverviewService(svc.authority, owner).c2()
    expect(res).toMatchObject({ ok: true, data: { commandsByStatus: null, recentCommands: [] } })
  })

  it('lists only projects the actor can access, with the status in its own vocabulary', async () => {
    const svc = createConsoleServices()
    const db = svc.authority.snapshot()
    const res = await createOverviewService(svc.authority, owner).projects()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const expected = db.projects.filter((p) => projectAccessible(p, owner)).map((p) => p.id)
    expect(res.data.map((p) => p.id)).toEqual(expected)
    for (const row of res.data) expect(db.projects.find((p) => p.id === row.id)?.status).toBe(row.status)
  })

  it('keeps the task list to the kinds the real inbox also tracks, each with a route into its project', async () => {
    const svc = createConsoleServices()
    const res = await createOverviewService(svc.authority, owner).tasks()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const kinds = new Set(['scope-revision', 'business-plan', 'c2-grant', 'report-review', 'finding-review', 'active-stop'])
    for (const task of res.data.items) {
      expect(kinds.has(task.kind)).toBe(true)
      expect(task.href).toMatch(/^(project\/[^?]+\?tab=|finding\/)/)
    }
  })
})
