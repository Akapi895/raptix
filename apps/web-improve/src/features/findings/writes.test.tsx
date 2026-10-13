/**
 * Ticket 32: finding write handlers — validated form saves, the 6-stage
 * lifecycle with role/state gates enforced at the handler, AI suggestions
 * imported as DRAFTS only (invariant 5), evidence attachment scope/masking,
 * retest outcomes, and the bridge observed in both directions (a service
 * write reaches the legacy consumer; a legacy write reaches the typed read —
 * ticket 31 proved the latter at the view layer, re-asserted here at the
 * handler layer). Screen-level cases pin the migrated form and detail
 * wiring: inline validation blocks bad submits and preserves the draft, and
 * lifecycle/AI actions refuse per role with reasons.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import type { ConsoleServices } from '../../domain/service-factory'
import { createConsoleServices } from '../../domain/service-factory'
import { createDatabaseAuthority } from '../../domain/database'
import { MockClock } from '../../domain/clock'
import type { ActorRef, RequestContext, ServiceResult } from '../../domain/service'
import type { Finding } from '../../domain/entities'
import type { FindingDetailRead } from './service'
import { routes } from '../../screens/e'
import {
  attachFindingEvidence, recordFindingRetest, saveFinding, transitionFinding, uploadFindingEvidence,
} from './service'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

/* ───────────── handler harness ───────────── */
function harness() {
  const clock = new MockClock()
  return { clock, authority: createDatabaseAuthority(clock) }
}
const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId: string, corr = 't'): RequestContext => ({ actor: a, projectId, corr })
const taylor = actor('Taylor Chen', 'operator') // createFinding, viewSensitive
const pat = actor('Pat Kim', 'reviewer') // reviewFinding, viewSensitive
const riley = actor('Riley Brooks', 'analyst') // createFinding; member of RT-2026-014 only
const casey = actor('Casey Nguyen (Client)', 'viewer') // nothing
const P14 = 'RT-2026-014'

const draftInput = { title: 'Probe finding from the write tests', severity: 'high' as const, asset: 'win-dc-01', desc: 'd', impact: 'i', rec: 'r', evidence: ['EV-014-01'], owner: 'Taylor Chen' }

const statusOf = (h: ReturnType<typeof harness>, id: string) =>
  h.authority.snapshot().findings.find((x) => x.id === id)!

describe('finding save handler (ticket 32 forms)', () => {
  it('creates a draft with a usable title alone, and submits with full validation', () => {
    const h = harness()
    const sparse = saveFinding(h.authority, h.clock, ctxOf(taylor, P14), null, { ...draftInput, asset: '', desc: '', impact: '', rec: '', evidence: [] })
    expect(sparse.ok).toBe(true)
    if (sparse.ok) {
      expect(sparse.data.status).toBe('draft')
      expect(sparse.data.id).toBe('FD-017')
    }
    // Sparse drafts cannot jump to review: the evidence requirement holds at the handler.
    const refused = saveFinding(h.authority, h.clock, ctxOf(taylor, P14), 'FD-017', { ...draftInput, asset: '', desc: '', impact: '', rec: '', evidence: [], submit: true })
    expect(refused).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('Select the affected asset') }) })
    expect(statusOf(h, 'FD-017').status).toBe('draft')
    h.authority.reset()
  })

  it('blocks bad submits: short title, unknown technique, cross-project evidence, no evidence on submit', () => {
    const h = harness()
    const before = h.authority.snapshot().findings.length
    expect(saveFinding(h.authority, h.clock, ctxOf(taylor, P14), null, { ...draftInput, title: 'bad' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('at least 5 characters') }) })
    expect(saveFinding(h.authority, h.clock, ctxOf(taylor, P14), null, { ...draftInput, technique: 'T9999', submit: true })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('Unknown ATT&CK technique') }) })
    expect(saveFinding(h.authority, h.clock, ctxOf(taylor, P14), null, { ...draftInput, asset: 'cloud-app-01', submit: true })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('belongs to the project') }) })
    expect(saveFinding(h.authority, h.clock, ctxOf(taylor, P14), null, { ...draftInput, severity: 'critical' as const, evidence: ['EV-014-01'], submit: true, severityReason: '' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('Critical severity requires a rationale') }) })
    expect(saveFinding(h.authority, h.clock, ctxOf(taylor, P14), null, { ...draftInput, evidence: [] , submit: true })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('At least 1 piece of evidence') }) })
    // Evidence references must resolve in the finding's own project (scope compatibility).
    expect(saveFinding(h.authority, h.clock, ctxOf(taylor, P14), null, { ...draftInput, evidence: ['EV-301'], submit: true })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('not part of project') }) })
    expect(h.authority.snapshot().findings.length).toBe(before)
    h.authority.reset()
  })

  it('create needs a specific project, membership and the createFinding role', () => {
    const h = harness()
    expect(saveFinding(h.authority, h.clock, ctxOf(taylor, 'all'), null, draftInput)).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Select a specific project') }) })
    expect(saveFinding(h.authority, h.clock, ctxOf(casey, P14), null, draftInput)).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'The Client / Viewer role cannot create findings.' }) })
    // A non-member's write is not-found — no existence leak (matches the read model; Riley is not a member of RT-2026-015).
    expect(saveFinding(h.authority, h.clock, ctxOf(riley, 'RT-2026-015'), null, draftInput)).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    h.authority.reset()
  })

  it('edits drafts and returned findings only; a confirmed finding refuses edits with a conflict', () => {
    const h = harness()
    expect(saveFinding(h.authority, h.clock, ctxOf(taylor, P14), 'FD-011', { ...draftInput, title: 'Edited confirmed finding' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('only drafts or returned findings can be edited') }) })
    const draft = createDraft(h)
    const edited = saveFinding(h.authority, h.clock, ctxOf(taylor, P14), draft, { ...draftInput, title: 'Edited probe title', evidence: ['EV-014-01', 'EV-014-02'] })
    expect(edited.ok).toBe(true)
    if (edited.ok) {
      expect(edited.data.title).toBe('Edited probe title')
      expect(edited.data.evidence).toEqual(['EV-014-01', 'EV-014-02'])
      expect(edited.data.history.at(-1)?.text).toBe('Content updated')
    }
    h.authority.reset()
  })
})

/* Draft → review helper used by the lifecycle suite. */
function createDraft(h: ReturnType<typeof harness>): string {
  const res = saveFinding(h.authority, h.clock, ctxOf(taylor, P14, 'draft'), null, draftInput)
  if (!res.ok) throw new Error('draft setup failed')
  return res.data.id
}

describe('lifecycle role gates (requirement 33, enforced at the handler)', () => {
  it('draft → review: author roles submit; a reviewer cannot submit (independent confirmation)', () => {
    const h = harness()
    const id = createDraft(h)
    expect(transitionFinding(h.authority, h.clock, ctxOf(pat, P14), id, 'review')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'The Reviewer role cannot submit findings for review.' }) })
    const res = transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'review')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.status).toBe('review')
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Submitted for review', actor: 'Taylor Chen', obj: id, projectId: P14 })
    h.authority.reset()
  })

  it('review → confirmed and review → returned are reviewer-only, with reasons for denials', () => {
    const h = harness()
    const id = createDraft(h)
    transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'review')
    expect(transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'confirmed')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'The Operator role cannot confirm findings.' }) })
    expect(transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'returned')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'The Operator role cannot return findings for changes.' }) })
    // A return needs a reason.
    expect(transitionFinding(h.authority, h.clock, ctxOf(pat, P14), id, 'returned')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('A reason is required') }) })
    const back = transitionFinding(h.authority, h.clock, ctxOf(pat, P14), id, 'returned', 'Needs stronger evidence')
    expect(back.ok).toBe(true)
    if (back.ok) {
      expect(back.data.status).toBe('returned')
      expect(back.data.comments.at(-1)?.text).toBe('Needs stronger evidence')
      expect(back.data.history.at(-1)?.text).toBe('Returned for changes: Needs stronger evidence')
    }
    expect(h.authority.snapshot().notices[0]).toMatchObject({ group: 'todo', text: `${id} was returned for changes` })
    h.authority.reset()
  })

  it('returned → review resubmits through the same author gate, then confirmed → remediation → retest → resolved', () => {
    const h = harness()
    const id = createDraft(h)
    transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'review')
    transitionFinding(h.authority, h.clock, ctxOf(pat, P14), id, 'returned', 'Tighten the evidence')
    // The author resubmits (return path), the reviewer confirms, the author moves remediation → retest.
    transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'review')
    transitionFinding(h.authority, h.clock, ctxOf(pat, P14), id, 'confirmed')
    transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'remediation')
    transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'retest')
    const done = transitionFinding(h.authority, h.clock, ctxOf(pat, P14), id, 'resolved')
    expect(done.ok).toBe(true)
    if (done.ok) expect(done.data.status).toBe('resolved')
    expect(statusOf(h, id).history.map((x) => x.text)).toEqual(['Draft created', 'Submitted for review', 'Returned for changes: Tighten the evidence', 'Submitted for review', 'Confirmed', 'Sent to remediation', 'Moved to retest', 'Marked resolved'])
    h.authority.reset()
  })

  it('denies illegal state moves, out-of-context writes and read-only projects', () => {
    const h = harness()
    const id = createDraft(h)
    expect(transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'confirmed')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('cannot move to confirmed') }) })
    // Cross-project context: refused with the owning project, no content change.
    expect(transitionFinding(h.authority, h.clock, ctxOf(taylor, 'RT-2026-015'), 'FD-011', 'remediation')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('belongs to project RT-2026-014') }) })
    // Non-member (Riley is not a member of RT-2026-015): not-found, no existence leak.
    expect(transitionFinding(h.authority, h.clock, ctxOf(riley, 'all'), 'FD-015', 'remediation')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    // Closed project (RT-2026-009): read-only regardless of role.
    expect(transitionFinding(h.authority, h.clock, ctxOf(pat, 'all'), 'FD-009', 'remediation')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('read-only') }) })
    expect(statusOf(h, 'FD-011').status).toBe('confirmed')
    h.authority.reset()
  })
})

describe('AI suggestions import as drafts only (invariant 5, requirement 34)', () => {
  it('importSuggestion lands an AI suggestion as a DRAFT for human curation', () => {
    const h = harness()
    const res = transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), 'FD-012', 'draft')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.status).toBe('draft')
      expect(res.data.history.at(-1)?.text).toBe('Imported AI suggestion as a draft')
    }
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Imported AI suggestion as a draft', actor: 'Taylor Chen', obj: 'FD-012' })
    h.authority.reset()
  })

  it('the transition map gives ai_suggested no route to review or confirmed — the AI never publishes', () => {
    const h = harness()
    expect(transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), 'FD-012', 'review')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict' }) })
    expect(transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), 'FD-012', 'confirmed')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict' }) })
    expect(statusOf(h, 'FD-012').status).toBe('ai_suggested')
    // Verification is human-gated: a reviewer (no createFinding) cannot import either.
    expect(transitionFinding(h.authority, h.clock, ctxOf(pat, P14), 'FD-012', 'draft')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'The Reviewer role cannot import AI suggestions.' }) })
    h.authority.reset()
  })

  it('an imported draft is curated like any draft: evidence attached, then submitted by a human', () => {
    const h = harness()
    transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), 'FD-012', 'draft')
    attachFindingEvidence(h.authority, h.clock, ctxOf(taylor, P14), 'FD-012', 'EV-014-01')
    const res = transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), 'FD-012', 'review')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.status).toBe('review')
    h.authority.reset()
  })
})

describe('evidence attachment scope, masking and uploads', () => {
  it('refuses cross-project references and evidence another finding holds', () => {
    const h = harness()
    expect(attachFindingEvidence(h.authority, h.clock, ctxOf(taylor, P14), 'FD-011', 'EV-301')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('not part of project RT-2026-014') }) })
    expect(attachFindingEvidence(h.authority, h.clock, ctxOf(taylor, P14), 'FD-012', 'EV-014-02')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('already linked to FD-011') }) })
    h.authority.reset()
  })

  it('links an unlinked capture in one commit; viewers are denied', () => {
    const h = harness()
    const res = attachFindingEvidence(h.authority, h.clock, ctxOf(taylor, P14), 'FD-011', 'EV-014-01')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.evidence).toContain('EV-014-01')
    expect(h.authority.snapshot().evidence.find((e) => e.id === 'EV-014-01')!.findingId).toBe('FD-011')
    expect(attachFindingEvidence(h.authority, h.clock, ctxOf(casey, P14), 'FD-011', 'EV-014-01')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'The Client / Viewer role cannot add evidence.' }) })
    h.authority.reset()
  })

  it('uploads record the capture inside the finding\'s own project and link it', () => {
    const h = harness()
    const res = uploadFindingEvidence(h.authority, h.clock, ctxOf(taylor, P14), { findingId: 'FD-011', name: 'probe-upload.png', kind: 'Image', source: 'OP-014 / manual', sensitive: false })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toMatchObject({ projectId: P14, findingId: 'FD-011', name: 'probe-upload.png' })
      expect(statusOf(h, 'FD-011').evidence).toContain(res.data.id)
    }
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Uploaded evidence', obj: res.ok ? res.data.id : '' })
    h.authority.reset()
  })
})

describe('retest recording (ticket 32)', () => {
  function toRetest(h: ReturnType<typeof harness>): string {
    const id = createDraft(h)
    transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'review')
    transitionFinding(h.authority, h.clock, ctxOf(pat, P14), id, 'confirmed')
    transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'remediation')
    transitionFinding(h.authority, h.clock, ctxOf(taylor, P14), id, 'retest')
    return id
  }
  it('a Resolved result closes the finding; a failed retest returns it to remediation', () => {
    const h = harness()
    const id = toRetest(h)
    const fixed = recordFindingRetest(h.authority, h.clock, ctxOf(taylor, P14), id, { result: 'Resolved', note: 'Least privilege applied.' })
    expect(fixed.ok).toBe(true)
    if (fixed.ok) {
      expect(fixed.data.status).toBe('resolved')
      expect(fixed.data.retests.at(-1)).toMatchObject({ result: 'Resolved', by: 'Taylor Chen' })
    }
    h.authority.reset()

    const h2 = harness()
    const id2 = toRetest(h2)
    const persists = recordFindingRetest(h2.authority, h2.clock, ctxOf(taylor, P14), id2, { result: 'Persists', note: 'Privilege still present.' })
    expect(persists.ok).toBe(true)
    if (persists.ok) expect(persists.data.status).toBe('remediation')
    expect(statusOf(h2, id2).history.at(-1)?.text).toContain('Retest not passed (Persists)')
    h2.authority.reset()
  })
  it('retests are gated to confirmed stages, need notes and the right roles', () => {
    const h = harness()
    // A draft finding is not confirmed yet — retest is a stage conflict.
    const draftId = createDraft(h)
    expect(recordFindingRetest(h.authority, h.clock, ctxOf(taylor, P14), draftId, { result: 'Resolved', note: 'n' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('only available after the finding has been confirmed') }) })
    const id = toRetest(h)
    expect(recordFindingRetest(h.authority, h.clock, ctxOf(taylor, P14), id, { result: 'Resolved', note: '   ' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'Enter notes about the retest.' }) })
    expect(recordFindingRetest(h.authority, h.clock, ctxOf(casey, P14), id, { result: 'Resolved', note: 'n' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'The Client / Viewer role cannot record retests.' }) })
    h.authority.reset()
  })
})

/* ───────────── bridge harness (legacy store + services, one authority) ───────────── */
function BridgeProbe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}
function mountBridge(me = 'Alex Morgan') {
  let store!: Store
  let svc!: ConsoleServices
  const view = render(
    <StoreProvider>
      <BridgeProbe ready={(s, v) => { store = s; svc = v }} />
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return { store: () => store, svc: () => svc, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

describe('bridge both directions for finding mutations', () => {
  it('a service transition is observed by the legacy consumer (new → legacy)', async () => {
    const h = mountBridge('Taylor Chen')
    let res!: ServiceResult<Finding>
    await act(async () => {
      res = await h.svc().findings(taylor, P14).transition(ctxOf(taylor, P14, 'svc'), 'FD-011', 'remediation')
    })
    expect(res.ok).toBe(true)
    expect(h.store().db.findings.find((x) => x.id === 'FD-011')!.status).toBe('remediation')
    expect(h.store().db).toBe(h.svc().authority.snapshot())
    h.unmount()
  })

  it('a legacy status change is observed by the typed read (legacy → new; re-asserts ticket 31)', async () => {
    const h = mountBridge('Taylor Chen')
    h.run(() => h.store().A.setFindingStatus('FD-012', 'review', 'Verified from AI suggestion by a human'))
    let res!: ServiceResult<FindingDetailRead>
    await act(async () => {
      res = await h.svc().findings(taylor, P14).get(ctxOf(taylor, P14), 'FD-012')
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.finding.status).toBe('review')
    h.unmount()
  })
})

describe('delayed-response and mid-flight isolation', () => {
  it('a superseded scope resolves an in-flight findings read as unavailable', async () => {
    const svc = createConsoleServices()
    let pending!: Promise<ServiceResult<unknown>>
    act(() => {
      pending = svc.findings(taylor, P14).list(ctxOf(taylor, P14))
      svc.cancelScope(taylor, P14)
    })
    expect(await pending).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'unavailable' }) })
    svc.dispose()
  })

  it('an in-flight write is never cancelled by a scope change; it commits once for its captured context', async () => {
    const svc = createConsoleServices()
    let res!: ServiceResult<Finding>
    await act(async () => {
      res = await svc.findings(taylor, P14).transition(ctxOf(taylor, P14, 'svc'), 'FD-011', 'remediation')
      svc.cancelScope(taylor, P14)
    })
    expect(res.ok).toBe(true)
    expect(svc.authority.snapshot().findings.find((x) => x.id === 'FD-011')!.status).toBe('remediation')
    svc.dispose()
  })
})

/* ───────────── migrated finding screen (forms + lifecycle wiring) ───────────── */
function ScreenProbe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}
/** Mounts the providers with a probe; `show(node)` mounts a screen into the
 *  SAME tree (the store's route was parsed at mount — navigate with `go()`). */
function mountScreenRoute(me = 'Alex Morgan') {
  let store!: Store
  let svc!: ConsoleServices
  const ui = (node: React.ReactNode) => (
    <StoreProvider>
      <ConsoleProviders>
        <ScreenProbe ready={(s, v) => { store = s; svc = v }} />
        {node}
      </ConsoleProviders>
    </StoreProvider>
  )
  const view = render(ui(null))
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    svc: () => svc,
    run: (fn: () => unknown) => act(fn),
    show: (node: React.ReactNode) => view.rerender(ui(node)),
    unmount: view.unmount,
  }
}

describe('finding form on the typed service (ticket 32)', () => {
  const Form = routes['finding-new']
  it('blocks a bad submit with inline errors, commits nothing, and preserves what was typed', async () => {
    window.location.hash = '#/finding-new'
    const h = mountScreenRoute('Taylor Chen')
    h.run(() => h.store().setPid(P14))
    h.show(<Form />)
    const title = await waitFor(() => screen.getByLabelText('Finding title *')) as HTMLInputElement
    fireEvent.change(title, { target: { value: 'abc' } })
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument() // dirty tracking
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(screen.getByText('Enter a finding title (at least 5 characters).')).toBeInTheDocument())
    expect(h.store().db.counters.finding).toBe(16) // nothing committed
    expect((screen.getByLabelText(/Finding title/) as HTMLInputElement).value).toBe('abc') // draft preserved
    // Completing the title lets the same draft save through the typed service.
    fireEvent.change(title, { target: { value: 'Probe finding from the form tests' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(h.store().db.counters.finding).toBe(17))
    const created = h.store().db.findings[0]
    expect(created).toMatchObject({ title: 'Probe finding from the form tests', status: 'draft', projectId: P14 })
    expect(h.store().db.audit[0]).toMatchObject({ action: 'Created draft finding', actor: 'Taylor Chen' })
    await waitFor(() => expect(h.store().route.page).toBe('finding'), { timeout: 3000 })
    h.unmount()
  })
})

describe('finding detail lifecycle on the typed service (ticket 32)', () => {
  it('gates confirm/return per role and runs the reviewer confirm through the handler', async () => {
    const h = mountScreenRoute('Taylor Chen')
    // Author creates and submits a probe draft (handler path).
    let created!: ServiceResult<Finding>
    await act(async () => {
      created = await h.svc().findings(taylor, P14).save(ctxOf(taylor, P14, 'probe'), null, { ...draftInput, title: 'Lifecycle probe finding', submit: true })
    })
    expect(created.ok).toBe(true)
    const id = created.ok ? created.data.id : 'FD-017'
    h.run(() => h.store().go('finding', { id }))
    h.show(<routes.finding />)
    await waitFor(() => expect(screen.getByText('Lifecycle probe finding')).toBeInTheDocument())
    // The operator (author) sees the reviewer gates as disabled actions with reasons.
    const confirmBtn = screen.getByRole('button', { name: 'Confirm Finding' })
    expect(confirmBtn).toBeDisabled()
    expect(confirmBtn.getAttribute('title')).toContain('Only a Reviewer or Manager can confirm findings.')
    // The reviewer confirms: the confirm dialog's captured handler runs the typed transition.
    act(() => { h.store().setMe('Pat Kim') })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Finding' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Finding' }))
    const opts = h.store().confirmState!
    expect(opts.confirmLabel).toBe('Confirm Finding')
    await act(async () => { opts.onConfirm('') })
    await waitFor(() => expect(h.store().db.findings.find((f) => f.id === id)!.status).toBe('confirmed'))
    expect(h.store().toasts.some((t) => t.text === `${id} was confirmed.`)).toBe(true)
    expect(h.store().db.audit[0]).toMatchObject({ action: 'Confirmed', actor: 'Pat Kim', obj: id })
    h.unmount()
  })

  it('verify & create finding imports an AI suggestion as a draft — never as review/confirmed', async () => {
    const h = mountScreenRoute('Taylor Chen')
    h.run(() => h.store().go('finding', { id: 'FD-012' }))
    h.show(<routes.finding />)
    await waitFor(() => expect(screen.getAllByText('AI Suggested — unverified').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Verify & create finding' }))
    const opts = h.store().confirmState!
    expect(opts.title).toContain('as a draft')
    await act(async () => { opts.onConfirm('') })
    await waitFor(() => expect(h.store().db.findings.find((f) => f.id === 'FD-012')!.status).toBe('draft'))
    expect(h.store().db.findings.find((f) => f.id === 'FD-012')!.history.at(-1)?.text).toBe('Imported AI suggestion as a draft')
    expect(h.store().toasts.some((t) => t.text === 'FD-012 imported as a draft finding.')).toBe(true)
    h.unmount()
  })
})
