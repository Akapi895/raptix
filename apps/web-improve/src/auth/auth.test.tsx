/**
 * Ticket 06: the shared permission policy is the one authorization authority.
 * The 6-role × 19-action matrix (plus viewer/member/non-member and
 * closed/cancelled contexts) is decided by `policy.ts`, the console read seam
 * (src/state/console.ts) derives the same decisions from the one database
 * authority, persona sign-in/switch/sign-out are observed by the shared auth
 * store, and no UI mode can flip an authorization decision. Ticket 02's
 * baseline expectations are preserved through the documented tables below
 * (same values, new execution site).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { seed, USERS, type Role } from '../data'
import { Login } from '../screens/a-login'
import { mountServices } from '../test/helpers'
import { ServicesProvider } from '../state/services'
import { useAuthStore, useUiStore } from '../state/stores'
import { useCan, useDb, useReadOnly, useScoped } from '../state/console'
import { selectProject } from '../router/navigate'
import { createConsoleServices } from '../domain/service-factory'
import type { CanAction } from '../domain/permissions'
import { accessibleProjectIds, listProjectMemberships } from './membership'
import { actorRef, signIn, signOut, switchPersona } from './persona'
import { can, canAccessProject, projectAccessible, readOnlyContext, ROLE_ACTIONS } from './policy'

afterEach(() => { cleanup(); window.location.hash = '' })

const PERSONA: Record<Role, string> = {
  admin: 'Dana Whitfield', manager: 'Alex Morgan', operator: 'Taylor Chen', reviewer: 'Pat Kim', analyst: 'Riley Brooks', viewer: 'Casey Nguyen (Client)',
}

const ACTIONS: CanAction[] = [
  'createProject', 'approve', 'editScope', 'run', 'createFinding', 'reviewFinding', 'editReport', 'approveReport',
  'requestClose', 'confirmClose', 'reopen', 'admin', 'viewSensitive', 'estop', 'plan', 'approvePlan', 'interactive', 'approveAccess', 'terminate',
]

/** The documented role policy (ticket 02's table — the spec's source of truth). */
const GRANTED: Record<Role, CanAction[]> = {
  admin: ['createProject', 'approve', 'editScope', 'confirmClose', 'reopen', 'admin', 'viewSensitive', 'estop', 'approvePlan', 'approveAccess', 'terminate'],
  manager: ['createProject', 'editScope', 'run', 'createFinding', 'reviewFinding', 'editReport', 'requestClose', 'viewSensitive', 'estop', 'plan', 'interactive', 'approveAccess', 'terminate'],
  operator: ['run', 'createFinding', 'editReport', 'viewSensitive', 'plan', 'interactive'],
  reviewer: ['approve', 'reviewFinding', 'approveReport', 'confirmClose', 'viewSensitive', 'approvePlan', 'approveAccess'],
  analyst: ['createFinding', 'editReport', 'viewSensitive'],
  viewer: [],
}

const db = seed()
const projectRef = (id: string) => db.projects.find((p) => p.id === id)

/* The console read seam probe: captures the authority-derived derivations the
   components consume (the store context's replacement). */
let latest!: {
  can: (a: CanAction, projectId?: string) => boolean
  readOnly: (projectId?: string) => boolean
  scoped: <T extends { projectId: string }>(arr: T[]) => T[]
  db: ReturnType<typeof seed>
}
function ConsoleProbe() {
  latest = { can: useCan(), readOnly: useReadOnly(), scoped: useScoped(), db: useDb() }
  return null
}

describe('permission policy: 6 roles × 19 actions (documented role policy)', () => {
  it('covers the full 19-action surface', () => {
    expect(new Set(Object.values(ROLE_ACTIONS).flat())).toEqual(new Set(ACTIONS))
    expect(ACTIONS).toHaveLength(19)
  })

  it('the policy matrix equals the documented grants for every role', () => {
    for (const role of Object.keys(PERSONA) as Role[]) {
      expect([...ROLE_ACTIONS[role]].sort(), role).toEqual([...GRANTED[role]].sort())
    }
  })

  for (const role of Object.keys(PERSONA) as Role[]) {
    it(`grants exactly the documented ${role} permissions and denies the other actions`, () => {
      const actor = actorRef(PERSONA[role])
      for (const a of ACTIONS) expect(can(actor, a), `${role} → ${a}`).toBe(GRANTED[role].includes(a))
    })
  }

  it('the console permission seam forwards the same decisions (execution-site equivalence)', () => {
    const h = mountServices(<ConsoleProbe />, 'Taylor Chen')
    for (const a of ACTIONS) expect(latest.can(a), `operator → ${a}`).toBe(can(actorRef('Taylor Chen'), a))
    h.as('Dana Whitfield')
    for (const a of ACTIONS) expect(latest.can(a), `admin → ${a}`).toBe(can(actorRef('Dana Whitfield'), a))
    h.unmount()
  })
})

describe('viewer/member/non-member and closed/cancelled contexts', () => {
  it('a non-member is denied every action on the project (ledger gap G-11 closed)', () => {
    const taylor = actorRef('Taylor Chen')
    for (const a of ACTIONS) expect(can(taylor, a, projectRef('PT-2026-006')), `operator/non-member → ${a}`).toBe(false)
    const riley = actorRef('Riley Brooks')
    for (const a of ACTIONS) expect(can(riley, a, projectRef('RT-2026-015')), `analyst/non-member → ${a}`).toBe(false)
    for (const a of ACTIONS) expect(can(riley, a, projectRef('RT-2026-014')), `analyst/member → ${a}`).toBe(GRANTED.analyst.includes(a))
  })

  it('the console seam forwards non-member denial for explicit ids and the active project', () => {
    const h = mountServices(<ConsoleProbe />, 'Taylor Chen')
    expect(latest.can('run', 'PT-2026-006')).toBe(false)
    expect(latest.can('run', 'RT-2026-014')).toBe(true)
    h.run(() => selectProject('RT-2026-014'))
    expect(latest.can('run')).toBe(true)
    h.unmount()
  })

  it('a non-member project never leaks into scoped reads in specific-project mode (ledger gap G-12 closed)', () => {
    const h = mountServices(<ConsoleProbe />, 'Riley Brooks')
    expect(latest.scoped(latest.db.findings).map((f) => f.id)).toEqual(['FD-011', 'FD-012'])
    h.run(() => selectProject('RT-2026-015'))
    expect(latest.scoped(latest.db.findings)).toEqual([])
    h.unmount()
  })

  it('on a closed project every action is denied except reopen (admin) and viewSensitive', () => {
    const dana = actorRef('Dana Whitfield')
    for (const a of ACTIONS) expect(can(dana, a, projectRef('RT-2026-009')), `admin/closed → ${a}`).toBe(a === 'reopen' || a === 'viewSensitive')
    const alex = actorRef('Alex Morgan')
    for (const a of ACTIONS) expect(can(alex, a, projectRef('RT-2026-009')), `manager/closed → ${a}`).toBe(a === 'viewSensitive')
  })

  it('a cancelled project behaves like a closed one (authority projection)', () => {
    const h = mountServices(<ConsoleProbe />)
    h.run(() => {
      // Fixture-style state staging: the cancelled status exists only to
      // exercise the read-side projection against the seeded demo data.
      h.svc().authority.commit('fixture-cancel', (d) => {
        const p = d.projects.find((x) => x.id === 'RT-2026-016')!
        p.status = 'cancelled'
      })
    })
    for (const a of ACTIONS) expect(latest.can(a, 'RT-2026-016'), `manager/cancelled → ${a}`).toBe(a === 'viewSensitive')
    expect(latest.readOnly('RT-2026-016')).toBe(true)
    h.unmount()
  })

  it('read-only context applies to closed projects and the viewer role', () => {
    const taylor = actorRef('Taylor Chen')
    expect(readOnlyContext(projectRef('RT-2026-014'), taylor)).toBe(false)
    expect(readOnlyContext(projectRef('RT-2026-009'), taylor)).toBe(true)
    expect(readOnlyContext(projectRef('RT-2026-014'), actorRef('Casey Nguyen (Client)'))).toBe(true)
  })

  it('the membership policy matches the documented table through both interfaces', () => {
    const PROJECTS = ['RT-2026-014', 'RT-2026-015', 'RT-2026-016', 'RT-2026-017', 'PT-2026-006', 'RT-2026-009']
    const table: Record<string, Record<string, boolean>> = {
      'Dana Whitfield': Object.fromEntries(PROJECTS.map((p) => [p, true])),
      'Alex Morgan': Object.fromEntries(PROJECTS.map((p) => [p, true])),
      'Pat Kim': Object.fromEntries(PROJECTS.map((p) => [p, true])),
      'Taylor Chen': { 'RT-2026-014': true, 'RT-2026-015': true, 'RT-2026-016': true, 'RT-2026-017': true, 'PT-2026-006': false, 'RT-2026-009': false },
      'Riley Brooks': { 'RT-2026-014': true, 'RT-2026-015': false, 'RT-2026-016': false, 'RT-2026-017': false, 'PT-2026-006': false, 'RT-2026-009': false },
      'Casey Nguyen (Client)': { 'RT-2026-014': true, 'RT-2026-015': false, 'RT-2026-016': false, 'RT-2026-017': false, 'PT-2026-006': false, 'RT-2026-009': false },
    }
    for (const [name] of Object.entries(table)) {
      for (const p of PROJECTS) {
        expect(projectAccessible(projectRef(p), actorRef(name)), `policy ${name} → ${p}`).toBe(table[name][p])
        expect(canAccessProject(db, USERS.find((u) => u.name === name)!, p), `legacy adapter ${name} → ${p}`).toBe(table[name][p])
      }
    }
  })
})

describe('service-backed membership view', () => {
  it('the membership read feeds the permission check (same rule, service-backed)', async () => {
    const svc = createConsoleServices()
    const taylor = actorRef('Taylor Chen')
    const ids = await accessibleProjectIds(svc, taylor)
    expect([...ids].sort()).toEqual(['RT-2026-014', 'RT-2026-015', 'RT-2026-016', 'RT-2026-017'])
    for (const p of svc.authority.snapshot().projects) {
      expect(projectAccessible(p, taylor), `policy ↔ service read: ${p.id}`).toBe(ids.has(p.id))
      expect(can(taylor, 'run', p), `run decision ↔ service read: ${p.id}`).toBe(ids.has(p.id))
    }
    svc.dispose()
  })

  it('the aggregate read lists every accessible project; a scoped read narrows to its project', async () => {
    const svc = createConsoleServices()
    const casey = actorRef('Casey Nguyen (Client)')
    const all = await listProjectMemberships(svc, casey)
    expect(all.ok && all.data.items.map((p) => p.id)).toEqual(['RT-2026-014'])
    const scoped = await listProjectMemberships(svc, casey, 'RT-2026-014')
    expect(scoped.ok && scoped.data.items.map((p) => p.id)).toEqual(['RT-2026-014'])
    const foreign = await listProjectMemberships(svc, casey, 'RT-2026-015')
    expect(foreign.ok && foreign.data.items).toEqual([])
    svc.dispose()
  })
})

describe('auth actions: persona login/select/logout consistency', () => {
  it('sign-in, persona switch and sign-out are observed by the shared auth surface and drive the permission seam', () => {
    const h = mountServices(<ConsoleProbe />)
    expect(useAuthStore.getState().meName).toBe('Alex Morgan')
    expect(useAuthStore.getState().authed).toBe(false)
    act(() => { signIn('Taylor Chen', 'Cyber Range Training — Sandbox') })
    expect(useAuthStore.getState().meName).toBe('Taylor Chen')
    expect(useAuthStore.getState().org).toBe('Cyber Range Training — Sandbox')
    expect(useAuthStore.getState().authed).toBe(true)
    act(() => { switchPersona('Pat Kim') })
    expect(useAuthStore.getState().meName).toBe('Pat Kim')
    expect(latest.can('approve')).toBe(true)
    expect(latest.can('run')).toBe(false)
    act(() => { signOut() })
    expect(useAuthStore.getState().authed).toBe(false)
    h.unmount()
  })

  it('UI modes and panels never flip authorization decisions', () => {
    const h = mountServices(<ConsoleProbe />, 'Casey Nguyen (Client)')
    const before = ACTIONS.map((a) => latest.can(a, 'RT-2026-014'))
    act(() => {
      useUiStore.getState().setAiMode('execution')
      useUiStore.getState().setSwitcherOpen(true)
      useUiStore.getState().setCopilotOpen(true, { kind: 'findings', label: 'Findings' })
      useUiStore.getState().setNoticesOpen(true)
    })
    expect(ACTIONS.map((a) => latest.can(a, 'RT-2026-014'))).toEqual(before)
    expect(latest.can('run', 'RT-2026-014')).toBe(false)
    h.as('Taylor Chen')
    expect(latest.can('approve', 'RT-2026-014')).toBe(false)
    h.unmount()
  })
})

describe('login screen stays wired through the auth actions', () => {
  it('the demo persona picker signs the selected persona in', () => {
    function AuthProbe() {
      const { authed, meName } = useAuthStore()
      return <div data-testid="probe">{String(authed)}:{meName}</div>
    }
    render(
      <ServicesProvider>
        <Login />
        <AuthProbe />
      </ServicesProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Pat Kim/ }))
    expect(screen.getByTestId('probe').textContent).toBe('true:Pat Kim')
    expect(useAuthStore.getState().meName).toBe('Pat Kim')
    expect(window.location.hash).toBe('#/command-center')
  })
})
