import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { seed, USERS } from '../data'
import type { Role } from '../data'
import { canAccessProject } from '../store'
import type { CanAction } from '../domain/permissions'
import { mountStore } from '../test/helpers'

afterEach(cleanup)

const PERSONA: Record<Role, string> = {
  admin: 'Dana Whitfield', manager: 'Alex Morgan', operator: 'Taylor Chen', reviewer: 'Pat Kim', analyst: 'Riley Brooks', viewer: 'Casey Nguyen (Client)',
}

const ACTIONS: CanAction[] = [
  'createProject', 'approve', 'editScope', 'run', 'createFinding', 'reviewFinding', 'editReport', 'approveReport',
  'requestClose', 'confirmClose', 'reopen', 'admin', 'viewSensitive', 'estop', 'plan', 'approvePlan', 'interactive', 'approveAccess', 'terminate',
]

const GRANTED: Record<Role, CanAction[]> = {
  admin: ['createProject', 'approve', 'editScope', 'confirmClose', 'reopen', 'admin', 'viewSensitive', 'estop', 'approvePlan', 'approveAccess', 'terminate'],
  manager: ['createProject', 'editScope', 'run', 'createFinding', 'reviewFinding', 'editReport', 'requestClose', 'viewSensitive', 'estop', 'plan', 'interactive', 'approveAccess', 'terminate'],
  operator: ['run', 'createFinding', 'editReport', 'viewSensitive', 'plan', 'interactive'],
  reviewer: ['approve', 'reviewFinding', 'approveReport', 'confirmClose', 'viewSensitive', 'approvePlan', 'approveAccess'],
  analyst: ['createFinding', 'editReport', 'viewSensitive'],
  viewer: [],
}

describe('RBAC baseline: 6 roles × 19 actions (documented role policy)', () => {
  it('covers the full 19-action surface', () => {
    expect(ACTIONS).toHaveLength(19)
  })

  for (const role of Object.keys(PERSONA) as Role[]) {
    it(`grants exactly the documented ${role} permissions and denies the other actions`, () => {
      const h = mountStore(PERSONA[role])
      for (const a of ACTIONS) {
        expect(h.store().can(a), `${role} → ${a}`).toBe(GRANTED[role].includes(a))
      }
      h.unmount()
    })
  }
})

describe('closed and cancelled projects are read-only (four-eyes context)', () => {
  it('on a closed project every action is denied except reopen (admin) and viewSensitive', () => {
    const h = mountStore('Dana Whitfield')
    for (const a of ACTIONS) {
      const expected = a === 'reopen' || a === 'viewSensitive'
      expect(h.store().can(a, 'RT-2026-009'), `admin/closed → ${a}`).toBe(expected)
    }
    h.unmount()
    const m = mountStore('Alex Morgan')
    for (const a of ACTIONS) expect(m.store().can(a, 'RT-2026-009'), `manager/closed → ${a}`).toBe(a === 'viewSensitive')
    m.unmount()
  })

  it('a cancelled project behaves like a closed one', () => {
    const h = mountStore('Alex Morgan')
    h.run(() => h.store().A.updateProject('RT-2026-016', { status: 'cancelled' }))
    for (const a of ACTIONS) {
      expect(h.store().can(a, 'RT-2026-016'), `manager/cancelled → ${a}`).toBe(a === 'viewSensitive')
    }
    expect(h.store().readOnly('RT-2026-016')).toBe(true)
    h.unmount()
  })
})

describe('project membership (canAccessProject policy)', () => {
  const db = seed()
  const PROJECTS = ['RT-2026-014', 'RT-2026-015', 'RT-2026-016', 'RT-2026-017', 'PT-2026-006', 'RT-2026-009']
  const table: Record<string, Record<string, boolean>> = {
    'Dana Whitfield': Object.fromEntries(PROJECTS.map((p) => [p, true])),
    'Alex Morgan': Object.fromEntries(PROJECTS.map((p) => [p, true])),
    'Pat Kim': Object.fromEntries(PROJECTS.map((p) => [p, true])),
    'Taylor Chen': { 'RT-2026-014': true, 'RT-2026-015': true, 'RT-2026-016': true, 'RT-2026-017': true, 'PT-2026-006': false, 'RT-2026-009': false },
    'Riley Brooks': { 'RT-2026-014': true, 'RT-2026-015': false, 'RT-2026-016': false, 'RT-2026-017': false, 'PT-2026-006': false, 'RT-2026-009': false },
    'Casey Nguyen (Client)': { 'RT-2026-014': true, 'RT-2026-015': false, 'RT-2026-016': false, 'RT-2026-017': false, 'PT-2026-006': false, 'RT-2026-009': false },
  }

  it('admins, managers and reviewers reach every project; operators, analysts and viewers need membership', () => {
    for (const [name] of Object.entries(table)) {
      for (const p of PROJECTS) {
        expect(canAccessProject(db, USERS.find((u) => u.name === name)!, p), `${name} → ${p}`).toBe(table[name][p])
      }
    }
  })

  it('read-only mode applies to closed projects and the viewer role', () => {
    const h = mountStore('Taylor Chen')
    expect(h.store().readOnly('RT-2026-014')).toBe(false)
    expect(h.store().readOnly('RT-2026-009')).toBe(true)
    h.as('Casey Nguyen (Client)')
    expect(h.store().readOnly('RT-2026-014')).toBe(true)
    h.unmount()
  })
})
