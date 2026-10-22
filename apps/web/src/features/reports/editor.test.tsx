/**
 * Ticket 35: section editor and report preview on typed services.
 *
 * Handlers: the editor/preview read (scope rules — a non-member's read is
 * not-found without a leak, a member scoped elsewhere gets forbidden with the
 * owning project on the entity ref — and the handler-computed `editReport`/
 * status gate) and the section writes (save/add/remove/reorder/findings), all
 * refusing locked approved content, missing roles and invalid selections at
 * the handler, never only in the screen. Screens: the editor autosaves
 * through the service (observable in the legacy db — one data authority),
 * keeps its draft on a refused save, guards navigation while dirty, persists
 * add/remove/reorder and renders the preview strictly read-only. Bridge:
 * a legacy `saveReportSection` refetches the migrated editor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useProjectStore } from '../../state/stores'
import { mountServices } from '../../test/helpers'
import { go } from '../../router/navigate'
import { useSessionStore } from '../../state/session'
import { createDatabaseAuthority } from '../../demo/authority'
import { MockClock } from '../../domain/clock'
import type { ActorRef, RequestContext } from '../../domain/service'
import { routes } from '../../screens/f'
import { addReportSection, readReportEditor, removeReportSection, reorderReportSections, saveReportSection, setReportFindings } from './mock';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

/* ───────────── handler harness ───────────── */
function harness() {
  const clock = new MockClock()
  return { clock, authority: createDatabaseAuthority(clock) }
}
const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId: string, corr = 't'): RequestContext => ({ actor: a, projectId, corr })
const alex = actor('Alex Morgan', 'manager') // editReport, elevated
const taylor = actor('Taylor Chen', 'operator') // editReport; member of 014/015/016/017
const casey = actor('Casey Nguyen (Client)', 'viewer') // member of 014, read-only role
const riley = actor('Riley Brooks', 'analyst') // editReport; member of RT-2026-014 only
const P14 = 'RT-2026-014'

describe('report editor read (ticket 35)', () => {
  it('returns the report aggregate with the gate and the project finding rows', () => {
    const h = harness()
    const read = readReportEditor(h.authority.snapshot(), ctxOf(alex, P14), 'REP-014')
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.data.report.id).toBe('REP-014')
      expect(read.data.project).toMatchObject({ id: P14, client: 'Northwind Bank (Demo)' })
      expect(read.data.canEdit).toBe(true)
      expect(read.data.editReason).toBe('')
      expect(read.data.findings.find((f) => f.id === 'FD-011')).toMatchObject({ linked: true, reportable: true })
      expect(read.data.findings.find((f) => f.id === 'FD-012')).toMatchObject({ linked: false, reportable: false, status: 'ai_suggested' })
      expect(read.data.linked.map((f) => f.id)).toEqual(['FD-011'])
      expect(read.data.linked[0]!.evidence).toEqual([{ ref: 'EV-014-02', sensitive: true }])
    }
    h.authority.reset()
  })

  it('refuses a non-member without leaking existence; a member scoped elsewhere can switch', () => {
    const h = harness()
    // Riley is a member of RT-2026-014 only: REP-015 is indistinguishable from a missing one.
    const refused = readReportEditor(h.authority.snapshot(), ctxOf(riley, 'all'), 'REP-015')
    expect(refused).toEqual({ ok: false, failure: { kind: 'not-found', message: 'This report does not exist or is not available for your account.', entity: { kind: 'report', id: 'REP-015' } } })
    expect(refused.ok || refused.failure.message).not.toContain('RT-2026-015')
    // Taylor can access RT-2026-014 but is scoped to RT-2026-015: forbidden with the owning project.
    expect(readReportEditor(h.authority.snapshot(), ctxOf(taylor, 'RT-2026-015'), 'REP-014'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', entity: { kind: 'report', id: 'REP-014', projectId: P14 } }) })
    h.authority.reset()
  })

  it('gates editing with reasons: locked approved content and the read-only viewer role', () => {
    const h = harness()
    // REP-009 is delivered: locked approved content is refused at the handler.
    const delivered = readReportEditor(h.authority.snapshot(), ctxOf(alex, 'RT-2026-009'), 'REP-009')
    expect(delivered.ok && !delivered.data.canEdit && delivered.data.editReason).toContain('Create a new version')
    const viewer = readReportEditor(h.authority.snapshot(), ctxOf(casey, P14), 'REP-014')
    expect(viewer.ok && !viewer.data.canEdit && viewer.data.editReason).toContain('cannot edit reports')
    h.authority.reset()
  })
})

describe('report section writes (ticket 35)', () => {
  it('saves one section body; unknown section, out-of-scope actor and locked content refuse', () => {
    const h = harness()
    const res = saveReportSection(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', 'exec', 'Updated summary.')
    expect(res.ok).toBe(true)
    expect(h.authority.snapshot().reports.find((r) => r.id === 'REP-014')!.sections.find((s) => s.id === 'exec')!.body).toBe('Updated summary.')
    expect(saveReportSection(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', 'nope', 'x')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation' }) })
    expect(saveReportSection(h.authority, h.clock, ctxOf(riley, P14), 'REP-015', 'exec', 'x')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    // A closed project is read-only regardless of role; a locked review status is a conflict.
    expect(saveReportSection(h.authority, h.clock, ctxOf(alex, 'RT-2026-009'), 'REP-009', 'exec', 'x')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('read-only') }) })
    expect(saveReportSection(h.authority, h.clock, ctxOf(alex, 'RT-2026-015'), 'REP-015', 'exec', 'x')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('read-only') }) })
    expect(saveReportSection(h.authority, h.clock, ctxOf(casey, P14), 'REP-014', 'exec', 'x')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('cannot edit reports') }) })
    h.authority.reset()
  })

  it('adds and removes sections with an audit row, refusing an empty title and the last section', () => {
    const h = harness()
    const added = addReportSection(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', 'Threat Intel')
    expect(added.ok).toBe(true)
    if (added.ok) {
      const last = added.data.sections[added.data.sections.length - 1]!
      expect(last).toMatchObject({ title: 'Threat Intel', body: '' })
      expect(last.id).not.toBe('') // generated, unique id
    }
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Added report section', obj: 'REP-014', actor: 'Taylor Chen' })
    expect(addReportSection(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', '   ')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation' }) })
    // Truncate to one section, then removal is refused.
    h.authority.commit('setup', (d) => { d.reports.find((r) => r.id === 'REP-014')!.sections = d.reports.find((r) => r.id === 'REP-014')!.sections.slice(0, 1) })
    expect(removeReportSection(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', 'cover')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('at least one section') }) })
    // A locked (In Review) report refuses removal; scope comes from the report's own project.
    const removed = removeReportSection(h.authority, h.clock, ctxOf(taylor, 'RT-2026-015'), 'REP-015', 'exec')
    expect(removed).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict' }) }) // REP-015 is In Review — locked
    h.authority.reset()
  })

  it('reorders sections and refuses a non-permutation order', () => {
    const h = harness()
    const ids = h.authority.snapshot().reports.find((r) => r.id === 'REP-014')!.sections.map((s) => s.id)
    const flipped = [...ids.slice(0, -2).reverse(), ...ids.slice(-2)]
    const res = reorderReportSections(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', flipped)
    expect(res.ok).toBe(true)
    expect(h.authority.snapshot().reports.find((r) => r.id === 'REP-014')!.sections.map((s) => s.id)).toEqual(flipped)
    expect(reorderReportSections(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', ids.slice(1))).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation' }) })
    expect(reorderReportSections(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', [...ids.slice(1), ids[1]!])).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation' }) })
    h.authority.reset()
  })

  it('validates finding selections: same project, confirmed-or-later for adds; unlinking persists', () => {
    const h = harness()
    expect(setReportFindings(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', ['FD-011', 'FD-012']))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('unverified AI suggestion') }) })
    expect(setReportFindings(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', ['FD-015']))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('not part of project RT-2026-014') }) })
    const unlinked = setReportFindings(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', [])
    expect(unlinked.ok && unlinked.data.findings).toEqual([])
    const relinked = setReportFindings(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', ['FD-011'])
    expect(relinked.ok && relinked.data.findings).toEqual(['FD-011'])
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Updated report findings', obj: 'REP-014' })
    h.authority.reset()
  })
})

/* ───────────── screen harness ───────────── */
/**
 * Mounts the providers with a probe; the store route parses `window.location.hash`
 * at mount, so set the deep link before `mountScreenRoute`. `pid` writes the raw
 * project store (the store's guarded `setPid` would redirect a detail page to its
 * list). `show` mounts screens into the same tree.
 */
function mountScreenRoute(me = 'Alex Morgan', pid?: string) {
  const h = mountServices(null, me)
  if (pid) act(() => { useProjectStore.getState().setPid(pid) })
  return h
}

const Editor = routes.report as React.ComponentType
const Preview = routes['report-preview'] as React.ComponentType

describe('report editor screen (ticket 35)', () => {
  it('renders from the typed read and autosaves a section through the service', async () => {
    window.location.hash = '#/report/REP-014'
    const h = mountScreenRoute('Taylor Chen')
    h.show(<Editor />)
    const box = (await screen.findByLabelText('Content of section Cover Page')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Typed by the migrated editor.' } })
    await waitFor(() => expect(useSessionStore.getState().dirty).toBe(true))
    // The typed write commits and the legacy store (one data authority) observes the same section.
    await waitFor(() => expect(h.db().reports.find((r) => r.id === 'REP-014')!.sections.find((s) => s.id === 'cover')!.body).toBe('Typed by the migrated editor.'), { timeout: 3000 })
    await waitFor(() => expect(useSessionStore.getState().dirty).toBe(false), { timeout: 3000 })
    h.unmount()
  })

  it('a refused save keeps the section draft and renders the failure', async () => {
    window.location.hash = '#/report/REP-014'
    const h = mountScreenRoute('Alex Morgan')
    const svc = h.svc()
    const orig = svc.reports.bind(svc)
    // Ticket 70: the facade returns a lazy-bound proxy, so the refusal is
    // injected by delegating every method to it and overriding only the save
    // handler — a spread would drop the lazy methods entirely.
    vi.spyOn(svc, 'reports').mockImplementation((a, p) => {
      const inner = orig(a, p)
      const refused = async () => ({ ok: false as const, failure: { kind: 'unavailable' as const, message: 'Simulated save failure.' } })
      return new Proxy(inner, { get: (t, prop) => (prop === 'saveSection' ? refused : Reflect.get(t, prop, t)) })
    })
    h.show(<Editor />)
    const box = (await screen.findByLabelText('Content of section Cover Page')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Draft kept on failure.' } })
    await waitFor(() => expect(screen.getByText('Could not save')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByText('Simulated save failure.')).toBeInTheDocument()
    expect((screen.getByLabelText('Content of section Cover Page') as HTMLTextAreaElement).value).toBe('Draft kept on failure.')
    h.unmount()
  })

  it('navigation while dirty opens the unsaved-changes guard whose save persists through the service', async () => {
    window.location.hash = '#/report/REP-014'
    const h = mountScreenRoute('Alex Morgan')
    h.show(<Editor />)
    const box = (await screen.findByLabelText('Content of section Cover Page')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Guarded draft.' } })
    await waitFor(() => expect(useSessionStore.getState().dirty).toBe(true))
    h.run(() => { go('reports') })
    expect(useSessionStore.getState().unsaved).not.toBeNull()
    expect(useSessionStore.getState().unsaved?.save).toBeTypeOf('function')
    h.run(() => { useSessionStore.getState().unsaved!.save!() })
    await waitFor(() => expect(h.db().reports.find((r) => r.id === 'REP-014')!.sections.find((s) => s.id === 'cover')!.body).toBe('Guarded draft.'), { timeout: 3000 })
    h.unmount()
  })

  it('add, reorder and remove of sections persist through the typed writes', async () => {
    window.location.hash = '#/report/REP-014'
    const h = mountScreenRoute('Alex Morgan')
    h.show(<Editor />)
    await screen.findByLabelText('Content of section Cover Page')
    fireEvent.change(screen.getByLabelText('New section title'), { target: { value: 'Threat Intel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.getAllByText('Threat Intel').length).toBeGreaterThan(0))
    const sectionsOf = () => h.db().reports.find((r) => r.id === 'REP-014')!.sections
    expect(sectionsOf().at(-1)).toMatchObject({ title: 'Threat Intel' })
    fireEvent.click(screen.getByRole('button', { name: 'Move Threat Intel up' }))
    await waitFor(() => expect(sectionsOf().at(-2)).toMatchObject({ title: 'Threat Intel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Threat Intel' }))
    expect(useSessionStore.getState().confirmState).not.toBeNull()
    h.run(() => { useSessionStore.getState().confirmState!.onConfirm('') })
    await waitFor(() => expect(screen.queryByText('Threat Intel')).not.toBeInTheDocument())
    expect(sectionsOf().some((s) => s.title === 'Threat Intel')).toBe(false)
    h.unmount()
  })

  it('gates the editor read-only with the handler reason for the viewer role', async () => {
    window.location.hash = '#/report/REP-014'
    const h = mountScreenRoute('Casey Nguyen (Client)', P14)
    h.show(<Editor />)
    await screen.findByText('Read-only')
    expect(screen.getAllByText(/cannot edit reports/).length).toBeGreaterThan(0)
    expect((screen.getByLabelText('Content of section Cover Page') as HTMLTextAreaElement).hasAttribute('readonly')).toBe(true)
    expect(screen.getByRole('button', { name: /Save Draft/ })).toBeDisabled()
    expect(screen.queryByLabelText('New section title')).not.toBeInTheDocument()
    h.unmount()
  })

  it('a legacy section save refetches the migrated editor (bridge: legacy → new)', async () => {
    window.location.hash = '#/report/REP-014'
    const h = mountScreenRoute('Alex Morgan')
    h.show(<Editor />)
    const box = (await screen.findByLabelText('Content of section Cover Page')) as HTMLTextAreaElement
    expect(box.value).toContain('Security Assessment Report')
    h.run(() => { expect(saveReportSection(h.svc().authority, h.svc().clock, ctxOf(alex, P14), 'REP-014', 'cover', 'Legacy bridge edit.').ok).toBe(true) })
    await waitFor(() => expect((screen.getByLabelText('Content of section Cover Page') as HTMLTextAreaElement).value).toBe('Legacy bridge edit.'))
    h.unmount()
  })

  it('a non-member opening a foreign report lands on not-found without a leak', async () => {
    window.location.hash = '#/report/REP-015'
    const h = mountScreenRoute('Riley Brooks') // member of RT-2026-014 only
    h.show(<Editor />)
    await screen.findByText('Report not found')
    expect(screen.getByText('This report does not exist or is not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText('Fabrikam Cloud')).not.toBeInTheDocument()
    h.unmount()
  })

  it('a member scoped to another project gets the switch affordance from the failure', async () => {
    window.location.hash = '#/report/REP-014'
    const h = mountScreenRoute('Taylor Chen', 'RT-2026-015')
    h.show(<Editor />)
    await screen.findByText('This report belongs to another project')
    expect(screen.getByRole('button', { name: 'Switch to project RT-2026-014' })).toBeInTheDocument()
    h.unmount()
  })
})

describe('report preview screen (ticket 35)', () => {
  it('renders the composed report read-only from the typed read', async () => {
    window.location.hash = '#/report-preview/REP-014'
    const h = mountScreenRoute('Pat Kim')
    h.show(<Preview />)
    expect(await screen.findByText('Security Assessment Report — Northwind Bank')).toBeInTheDocument()
    expect(screen.getAllByText('DRAFT').length).toBeGreaterThan(0) // per-page draft watermark
    expect(screen.getAllByText('FD-011').length).toBeGreaterThan(0)
    expect(screen.getAllByText('EV-014-02 [redacted]').length).toBeGreaterThan(0)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    h.unmount()
  })
})
