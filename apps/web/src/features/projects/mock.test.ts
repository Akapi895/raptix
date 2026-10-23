import { describe, expect, it } from 'vitest'
import type { Project } from '../../domain/entities'
import { createProjectsService, projectRow } from './mock'

const demo = { id: 'RT-2026-014', name: 'Internal Red Team Q4', client: 'Northwind Bank (Demo)', status: 'active', updated: 'Oct 12, 2026' } as unknown as Project

describe('demo project list port', () => {
  it('maps a demo project to the port row, leaving what the demo does not record null', () => {
    expect(projectRow(demo)).toEqual({ id: 'RT-2026-014', name: 'Internal Red Team Q4', workspaceSlug: null, target: null, targetType: null, metadataVerified: null, status: 'active', updatedAt: 'Oct 12, 2026', updatedAtIso: null })
  })

  it('passes a failed accessible-list read through as the failure, never as an empty list', async () => {
    const service = createProjectsService(async () => ({ ok: false, failure: { kind: 'forbidden', message: 'no access' } }))
    expect(await service.list()).toEqual({ ok: false, failure: { kind: 'forbidden', message: 'no access' } })
  })

  it('maps the accessible page into rows in the order the read returns them', async () => {
    const service = createProjectsService(async () => ({ ok: true, data: { items: [demo], page: 1, pageSize: 50, total: 1 } }))
    const res = await service.list()
    expect(res.ok && res.data.map((row) => row.id)).toEqual(['RT-2026-014'])
  })
})
