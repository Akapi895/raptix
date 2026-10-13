/**
 * Ticket 36: report review + immutable approved versions + export/delivery.
 *
 * Handlers: the review transitions (submit/resubmit with version snapshots,
 * approve/return with the four-eyes policy — the author can never decide
 * their own report — reviewer-role gating and mandatory decision comments)
 * and the delivery chain (export of an approved version with its checksum on
 * the export record, delivery of an exported version with the handover
 * record, recipient acknowledgement). Screens: the review screen renders the
 * handler gates with reasons and decides/exports/delivers through the typed
 * writes; the editor's submit pins the version snapshot. Bridge: both
 * directions — a legacy approval refetches the migrated review screen, and
 * the typed delivery chain is observed by the legacy store and the catalog's
 * kind-aligned delivery history.
 *
 * Ticket 37 (export and delivery records): the handover confirmation gate at
 * the handler, stale-version delivery refusals, the persisted handover
 * history (actor/instant/reason/version on the record + audit row), the
 * closure consumer observing a typed delivery through the shared authority,
 * and the legacy export/delivery store actions delegating to the same
 * handlers (legacy export refetches the typed delivery history).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createHashRouter, RouterProvider } from 'react-router'
import { ConsoleProviders } from '../../state/query'
import { useProjectStore } from '../../state/stores'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import { setActiveRouter } from '../../router/active'
import { RouteErrorBoundary, RouteHost } from '../../router/host'
import type { ConsoleServices } from '../../domain/service-factory'
import { createDatabaseAuthority } from '../../domain/database'
import { MockClock } from '../../domain/clock'
import type { ActorRef, RequestContext } from '../../domain/service'
import { routes } from '../../screens/f'
import {
  acknowledgeDelivery, decideReport, deliverReportVersion, exportReportVersion,
  readReportReview, saveReportSection, submitReportVersion,
} from './service'
import { useDeliveryHistory } from './query'
import { evaluateCloseChecklist } from '../closure/service'
import type { DeliveryListRead } from './service'

afterEach(() => { cleanup(); vi.restoreAllMocks(); setActiveRouter(null); window.location.hash = '' })

/* ───────────── handler harness ───────────── */
function harness() {
  const clock = new MockClock()
  return { clock, authority: createDatabaseAuthority(clock) }
}
const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId: string, corr = 't'): RequestContext => ({ actor: a, projectId, corr })
const alex = actor('Alex Morgan', 'manager') // editReport; author of REP-014
const pat = actor('Pat Kim', 'reviewer') // approveReport
const taylor = actor('Taylor Chen', 'operator') // editReport only
const casey = actor('Casey Nguyen (Client)', 'viewer') // nothing
const riley = actor('Riley Brooks', 'analyst') // member of RT-2026-014 only
const P14 = 'RT-2026-014'
const P15 = 'RT-2026-015'

const dbOf = (h: ReturnType<typeof harness>) => h.authority.snapshot()

describe('report review transitions (ticket 36)', () => {
  it('submits a draft for review: status, review entry, audit, notice and version snapshot in one commit', () => {
    const h = harness()
    const res = submitReportVersion(h.authority, h.clock, ctxOf(alex, P14), 'REP-014', { bodies: { exec: 'Summary of the assessment.' } })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toMatchObject({ id: 'REP-014', status: 'review', version: 'v0.3' })
      expect(res.data.snapshots).toHaveLength(1)
      expect(res.data.snapshots![0]).toMatchObject({ version: 'v0.3', by: 'Alex Morgan', findings: ['FD-011'] })
      expect(res.data.snapshots![0].bodies['exec']).toBe('Summary of the assessment.')
      expect(res.data.reviews[0]).toMatchObject({ action: 'Submitted for review', by: 'Alex Morgan', version: 'v0.3' })
    }
    expect(dbOf(h).audit[0]).toMatchObject({ action: 'Submitted report for review', actor: 'Alex Morgan', obj: 'REP-014' })
    expect(dbOf(h).notices.some((n) => n.text.includes('REP-014 needs review') && n.to.name === 'report-review')).toBe(true)
    h.authority.reset()
  })

  it('gates submit: role, read-only context, state and cross-project scope without a leak', () => {
    const h = harness()
    expect(submitReportVersion(h.authority, h.clock, ctxOf(pat, P14), 'REP-014', { bodies: {} }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('(Reviewer) cannot edit reports') }) })
    expect(submitReportVersion(h.authority, h.clock, ctxOf(casey, P14), 'REP-014', { bodies: {} }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('(Client / Viewer) cannot edit reports') }) })
    // A closed project is read-only regardless of role.
    expect(submitReportVersion(h.authority, h.clock, ctxOf(alex, 'RT-2026-009'), 'REP-009', { bodies: {} }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('read-only') }) })
    expect(submitReportVersion(h.authority, h.clock, ctxOf(alex, P15), 'REP-015', { bodies: {} }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('In Review') }) })
    const refused = submitReportVersion(h.authority, h.clock, ctxOf(riley, 'all'), 'REP-015', { bodies: {} })
    expect(refused).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(refused.ok || refused.failure.message).not.toContain(P15)
    h.authority.reset()
  })

  it('return and resubmit produce a traceable revision with reviewer notes and a new version', () => {
    const h = harness()
    submitReportVersion(h.authority, h.clock, ctxOf(alex, P14), 'REP-014', { bodies: {} })
    expect(decideReport(h.authority, h.clock, ctxOf(alex, P14), 'REP-014', 'return', 'Self-return.'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('the Red Team Manager role cannot') }) })
    expect(decideReport(h.authority, h.clock, ctxOf(taylor, P14), 'REP-014', 'return', 'Tighten it.'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only a Reviewer') }) })
    const back = decideReport(h.authority, h.clock, ctxOf(pat, P14), 'REP-014', 'return', 'Tighten the executive summary.')
    expect(back.ok && back.data.status).toBe('returned')
    expect(back.ok && back.data.reviews[1]).toMatchObject({ action: 'Changes requested', by: 'Pat Kim', note: 'Tighten the executive summary.' })
    const again = submitReportVersion(h.authority, h.clock, ctxOf(alex, P14), 'REP-014', { bodies: { exec: 'Revised summary.' } })
    expect(again.ok && again.data.version).toBe('v0.4')
    expect(again.ok && again.data.reviews.map((x) => x.action)).toEqual(['Submitted for review', 'Changes requested', 'Submitted for review'])
    expect(again.ok && again.data.snapshots!.map((s) => s.version)).toEqual(['v0.3', 'v0.4'])
    h.authority.reset()
  })

  it('gates decisions: wrong state, wrong role, missing mandatory comment', () => {
    const h = harness()
    // REP-014 is a draft: not decidable.
    expect(decideReport(h.authority, h.clock, ctxOf(pat, P14), 'REP-014', 'approve', 'ok'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('only while it is In Review') }) })
    expect(decideReport(h.authority, h.clock, ctxOf(alex, P15), 'REP-015', 'approve', 'ok'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only a Reviewer') }) })
    expect(decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', '   '))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('approval reasoning is required') }) })
    expect(decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'return', ''))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('comment for the author is required') }) })
    h.authority.reset()
  })

  it('enforces four-eyes at the handler: the author can never decide their own report', () => {
    const h = harness()
    h.authority.commit('setup', (d) => { d.reports.find((r) => r.id === 'REP-015')!.author = 'Pat Kim' })
    const res = decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'self')
    expect(res).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('four-eyes') }) })
    expect(dbOf(h).reports.find((r) => r.id === 'REP-015')!.status).toBe('review')
    h.authority.reset()
  })

  it('approval pins the version snapshot and records the reasoning in the canonical review history', () => {
    const h = harness()
    const res = decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'Content verified against IAM evidence.')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.status).toBe('approved')
      expect(res.data.reviews[1]).toMatchObject({ action: 'Approved', by: 'Pat Kim', note: 'Content verified against IAM evidence.', version: 'v1.0' })
      // No submitted snapshot existed (legacy review path), so approval pins the committed content.
      expect(res.data.snapshots!.find((s) => s.version === 'v1.0')).toMatchObject({ pinned: true, by: 'Pat Kim' })
    }
    expect(dbOf(h).audit[0]).toMatchObject({ action: 'Approved report', actor: 'Pat Kim', reason: 'Content verified against IAM evidence.' })
    // A later edit starts a new draft — locked approved content is refused and the pinned snapshot stays.
    const denied = saveReportSection(h.authority, h.clock, ctxOf(alex, P15), 'REP-015', 'exec', 'mutated')
    expect(denied).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('read-only') }) })
    expect(dbOf(h).reports.find((r) => r.id === 'REP-015')!.snapshots!.find((s) => s.version === 'v1.0')).toMatchObject({ pinned: true })
    h.authority.reset()
  })

  it('the review read carries gates, checklist and exports; scope rules mirror the editor read', () => {
    const h = harness()
    const patRead = readReportReview(dbOf(h), ctxOf(pat, P15), 'REP-015')
    expect(patRead.ok).toBe(true)
    if (patRead.ok) {
      expect(patRead.data.project).toMatchObject({ id: P15, client: 'Fabrikam Cloud (Demo)', roeVersion: 'ROE-015-v1' })
      expect(patRead.data.checks.map((c) => c.id)).toEqual(['exec', 'find', 'conf', 'empty', 'tpl'])
      expect(patRead.data.linked[0]).toMatchObject({ id: 'FD-015', status: 'confirmed', evidence: [{ ref: 'EV-301', sensitive: false }] })
      expect(patRead.data.gates.decide).toMatchObject({ allowed: true, reason: '' })
      expect(patRead.data.gates.export.reason).toContain('Export unlocks after the report is approved')
      expect(patRead.data.gates.deliver.reason).toContain('approved and exported')
      expect(patRead.data.gates.ack.reason).toContain('delivered')
      expect(patRead.data.exports).toHaveLength(0)
    }
    // The blocking checklist is surfaced for the approver's reason.
    const blocked = readReportReview(dbOf(h), ctxOf(pat, P14), 'REP-014')
    expect(blocked.ok && blocked.data.checks.some((c) => c.id === 'empty' && c.state === 'warn')).toBe(true)
    // Non-member: not-found without a leak; member scoped elsewhere: forbidden with the owning project.
    const leak = readReportReview(dbOf(h), ctxOf(riley, 'all'), 'REP-015')
    expect(leak).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(leak.ok || leak.failure.message).not.toContain(P15)
    expect(readReportReview(dbOf(h), ctxOf(taylor, 'RT-2026-014'), 'REP-015'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', entity: { kind: 'report', id: 'REP-015', projectId: P15 } }) })
    // Viewer: every gate is disallowed (the draft's status gates fire for this readable report).
    const viewer = readReportReview(dbOf(h), ctxOf(casey, P14), 'REP-014')
    expect(viewer.ok && !viewer.data.gates.decide.allowed && viewer.data.gates.decide.reason).toContain('In Review')
    expect(viewer.ok && !viewer.data.gates.export.allowed && !viewer.data.gates.deliver.allowed).toBe(true)
    h.authority.reset()
  })
})

describe('report export and delivery (ticket 36)', () => {
  it('exports an approved version: record content identical to the baseline export shape, checksum on the record', () => {
    const h = harness()
    expect(exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('Export unlocks after the report is approved') }) })
    decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'ok')
    const res = exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.rec).toMatchObject({ id: 'EX-92', reportId: 'REP-015', version: 'v1.0', format: 'PDF', by: 'Pat Kim', recipient: '—', status: 'Completed' })
      expect(res.data.rec.checksum).toMatch(/^sha256:[0-9a-f]{4}…[0-9a-f]{4}$/)
      expect(res.data.report.status).toBe('exported')
    }
    expect(dbOf(h).audit[0]).toMatchObject({ action: 'Exported report (PDF)', actor: 'Pat Kim', obj: 'REP-015' })
    h.authority.reset()
  })

  it('gates export and delivery with reasons: state first, then role, then cross-project scope', () => {
    const h = harness()
    // The state gate fires before the role gate (mirroring the baseline reason order).
    expect(exportReportVersion(h.authority, h.clock, ctxOf(taylor, P15), 'REP-015', 'DOCX'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('Export unlocks after the report is approved') }) })
    expect(deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'Fabrikam Cloud (Demo)', channel: 'Secure portal', notes: '', confirm: true }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('has not been approved') }) })
    // A closed project is read-only before any state or role consideration.
    expect(exportReportVersion(h.authority, h.clock, ctxOf(pat, 'RT-2026-009'), 'REP-009', 'PDF'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('read-only') }) })
    const leak = exportReportVersion(h.authority, h.clock, ctxOf(riley, 'all'), 'REP-015', 'PDF')
    expect(leak).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(leak.ok || leak.failure.message).not.toContain(P15)
    // After approval the role gate fires: operator/viewer cannot export or deliver.
    decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'ok')
    expect(exportReportVersion(h.authority, h.clock, ctxOf(taylor, P15), 'REP-015', 'DOCX'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('(Operator) cannot export reports') }) })
    expect(deliverReportVersion(h.authority, h.clock, ctxOf(taylor, P15), 'REP-015', { recipient: 'x', channel: 'Secure portal', notes: '', confirm: true }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('cannot mark delivery') }) })
    // A delivered report refuses further exports while its project is active.
    exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF')
    deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'Mai Ellis', channel: 'Secure portal', notes: '', confirm: true })
    expect(exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already delivered') }) })
    h.authority.reset()
  })

  it('delivery requires an export of the exact version and stamps the handover record; export alone is not delivery', () => {
    const h = harness()
    decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'ok')
    expect(deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'x', channel: 'Secure portal', notes: '', confirm: true }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('no valid export exists for this version') }) })
    exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF')
    expect(deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: '   ', channel: 'Secure portal', notes: '', confirm: true }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'Enter the recipient.' }) })
    const res = deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'Mai Ellis', channel: 'Secure portal', notes: 'Handed over via portal.', confirm: true })
    expect(res.ok && res.data.status).toBe('delivered')
    const rec = dbOf(h).exportsList.find((e) => e.id === 'EX-92')!
    expect(rec).toMatchObject({ recipient: 'Mai Ellis', status: 'Delivered', channel: 'Secure portal', notes: 'Handed over via portal.', version: 'v1.0' })
    expect(dbOf(h).reports.find((r) => r.id === 'REP-015')!.deliveredAt).toBeTruthy()
    expect(dbOf(h).audit[0]).toMatchObject({ action: 'Marked as delivered', obj: 'REP-015', reason: 'Mai Ellis' })
    expect(deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'x', channel: 'Secure portal', notes: '', confirm: true }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already delivered') }) })
    h.authority.reset()
  })

  it('records the recipient acknowledgement on the delivered export record, idempotently', () => {
    const h = harness()
    expect(acknowledgeDelivery(h.authority, h.clock, ctxOf(pat, P15), 'REP-015'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('Only a delivered report') }) })
    decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'ok')
    exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF')
    deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'Mai Ellis', channel: 'Secure portal', notes: '', confirm: true })
    const res = acknowledgeDelivery(h.authority, h.clock, ctxOf(pat, P15), 'REP-015')
    expect(res.ok && res.data.ackAt).toBeTruthy()
    expect(dbOf(h).audit[0]).toMatchObject({ action: 'Recorded delivery acknowledgement', obj: 'REP-015' })
    const again = acknowledgeDelivery(h.authority, h.clock, ctxOf(pat, P15), 'REP-015')
    expect(again.ok && again.data.ackAt).toBe(res.ok ? res.data.ackAt : undefined)
    h.authority.reset()
  })
})

describe('report export and delivery records (ticket 37)', () => {
  it('refuses delivery without the explicit handover confirmation; a refused attempt commits nothing', () => {
    const h = harness()
    decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'ok')
    exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF')
    const refused = deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'Mai Ellis', channel: 'Secure portal', notes: '', confirm: false })
    expect(refused).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('Confirm that the handover happened') }) })
    // Export alone is not delivery: the export record stays unclaimed and no audit row lands.
    expect(dbOf(h).reports.find((r) => r.id === 'REP-015')!.status).toBe('exported')
    expect(dbOf(h).exportsList.filter((e) => e.reportId === 'REP-015').every((e) => e.status === 'Completed' && !e.deliveredBy)).toBe(true)
    expect(dbOf(h).audit.some((a) => a.action === 'Marked as delivered' && a.obj === 'REP-015')).toBe(false)
    h.authority.reset()
  })

  it('a stale export version cannot deliver a newer approved version; a fresh export of that version can', () => {
    const h = harness()
    decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'ok')
    exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF')
    // The report goes back through the legacy path; the canonical resubmit advances the version.
    h.authority.commit('legacy-return', (d) => { d.reports.find((x) => x.id === 'REP-015')!.status = 'returned' })
    const again = submitReportVersion(h.authority, h.clock, ctxOf(alex, P15), 'REP-015', { bodies: {} })
    expect(again.ok && again.data.version).toBe('v1.1')
    decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'ok')
    const stale = deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'Mai Ellis', channel: 'Secure portal', notes: '', confirm: true })
    expect(stale).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('no valid export exists for this version') }) })
    // The stale v1.0 export record is untouched by the refused delivery.
    expect(dbOf(h).exportsList.find((e) => e.version === 'v1.0')).toMatchObject({ status: 'Completed', recipient: '—' })
    exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'DOCX')
    const fresh = deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'Mai Ellis', channel: 'Secure portal', notes: '', confirm: true })
    expect(fresh.ok).toBe(true)
    expect(dbOf(h).exportsList.filter((e) => e.reportId === 'REP-015' && e.status === 'Delivered').map((e) => e.version)).toEqual(['v1.1'])
    h.authority.reset()
  })

  it('persists the handover history: actor, delivery instant, reason and version on the record plus the audit row', () => {
    const h = harness()
    decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'ok')
    exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF')
    h.clock.advance(90_000)
    const res = deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'Mai Ellis', channel: 'Encrypted email', notes: 'Handed over via encrypted mail.', confirm: true })
    expect(res.ok).toBe(true)
    const rec = dbOf(h).exportsList.find((e) => e.reportId === 'REP-015' && e.status === 'Delivered')!
    expect(rec).toMatchObject({ reportId: 'REP-015', version: 'v1.0', recipient: 'Mai Ellis', channel: 'Encrypted email', notes: 'Handed over via encrypted mail.', deliveredBy: 'Pat Kim' })
    // The delivery instant is its own stamp, distinct from the export record's.
    expect(rec.deliveredAt).toBeTruthy()
    expect(rec.deliveredAt).not.toBe(rec.at)
    expect(dbOf(h).audit[0]).toMatchObject({ action: 'Marked as delivered', actor: 'Pat Kim', reason: 'Mai Ellis', obj: 'REP-015' })
    // The review read resolves the immutable delivery audit row for the screen.
    const read = readReportReview(dbOf(h), ctxOf(pat, P15), 'REP-015')
    expect(read.ok && read.data.deliveryAuditId).toBe(dbOf(h).audit[0].id)
    h.authority.reset()
  })

  it('the closure checklist observes a typed delivery through the shared authority (closure consumer)', () => {
    const h = harness()
    expect(evaluateCloseChecklist(dbOf(h), P15).find((c) => c.id === 'c3')).toMatchObject({ ok: false, detail: 'No report has been delivered' })
    decideReport(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'approve', 'ok')
    exportReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', 'PDF')
    deliverReportVersion(h.authority, h.clock, ctxOf(pat, P15), 'REP-015', { recipient: 'Mai Ellis', channel: 'Secure portal', notes: '', confirm: true })
    const c3 = evaluateCloseChecklist(dbOf(h), P15).find((c) => c.id === 'c3')!
    expect(c3.ok).toBe(true)
    expect(c3.detail).toBe('A report is Delivered')
    h.authority.reset()
  })
})

/* ───────────── screen harness ───────────── */
function ScreenProbe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}
function mountScreenRoute(me = 'Alex Morgan', pid?: string) {
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
  if (pid) act(() => { useProjectStore.getState().setPid(pid) })
  return {
    store: () => store,
    svc: () => svc,
    run: (fn: () => unknown) => act(fn),
    show: (node: React.ReactNode) => view.rerender(ui(node)),
    unmount: view.unmount,
  }
}

const Review = routes['report-review'] as React.ComponentType
const Editor = routes.report as React.ComponentType

describe('report review screen (ticket 36)', () => {
  it('renders the handler gating with reasons for a non-reviewer', async () => {
    window.location.hash = '#/report-review/REP-015'
    const h = mountScreenRoute('Taylor Chen', P15)
    h.show(<Review />)
    await screen.findByText('Cloud Lab Report — Fabrikam Cloud')
    expect(screen.getAllByText(/Only a Reviewer can approve or return reports/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Approve Report' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mark as Delivered' })).toBeDisabled()
    h.unmount()
  })

  it('a non-member opening a foreign report review lands on not-found without a leak', async () => {
    window.location.hash = '#/report-review/REP-015'
    const h = mountScreenRoute('Riley Brooks')
    h.show(<Review />)
    await screen.findByText('Report not found')
    expect(screen.queryByText('Fabrikam Cloud')).not.toBeInTheDocument()
    h.unmount()
  })

  it('approve → export → deliver through the typed writes updates the legacy store and this screen', async () => {
    window.location.hash = '#/report-review/REP-015'
    const h = mountScreenRoute('Pat Kim', P15)
    h.show(<Review />)
    await screen.findByText('Cloud Lab Report — Fabrikam Cloud')
    // Delivery is gated until the export exists (step 2 first).
    expect(screen.getByRole('button', { name: 'Mark as Delivered' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Approve Report' }))
    h.run(() => { h.store().confirmState!.onConfirm('Content verified against IAM evidence.') })
    await waitFor(() => expect(h.store().db.reports.find((r) => r.id === 'REP-015')!.status).toBe('approved'), { timeout: 3000 })
    expect(h.store().db.reports.find((r) => r.id === 'REP-015')!.reviews[1]!.note).toBe('Content verified against IAM evidence.')
    // The refetched read re-gates the buttons before the next step.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export PDF' })).toBeEnabled(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    await waitFor(() => expect(h.store().db.reports.find((r) => r.id === 'REP-015')!.status).toBe('exported'), { timeout: 3000 })
    await waitFor(() => expect(screen.getAllByText(/EX-92/).length).toBeGreaterThan(0), { timeout: 3000 })
    // The delivery card requires the handover record: recipient + confirmation.
    fireEvent.change(screen.getByLabelText(/Recipient/), { target: { value: 'Fabrikam Cloud (Demo)' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Handover to the recipient is confirmed/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark as Delivered' })).toBeEnabled(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Delivered' }))
    await waitFor(() => expect(h.store().db.reports.find((r) => r.id === 'REP-015')!.status).toBe('delivered'), { timeout: 3000 })
    const rec = h.store().db.exportsList.find((e) => e.id === 'EX-92')!
    expect(rec).toMatchObject({ status: 'Delivered', recipient: 'Fabrikam Cloud (Demo)', channel: 'Secure portal' })
    expect(await screen.findByText(/Awaiting recipient acknowledgement/)).toBeInTheDocument()
    h.unmount()
  })

  it('a legacy approval refetches the migrated review screen (bridge: legacy → new)', async () => {
    window.location.hash = '#/report-review/REP-015'
    const h = mountScreenRoute('Pat Kim', P15)
    h.show(<Review />)
    await screen.findByText('Cloud Lab Report — Fabrikam Cloud')
    expect(screen.queryByText('Version v1.0 is locked')).not.toBeInTheDocument()
    h.run(() => { h.store().A.approveReport('REP-015') })
    await waitFor(() => expect(screen.getByText('Version v1.0 is locked')).toBeInTheDocument(), { timeout: 3000 })
    h.unmount()
  })

  it('the editor submit pins the version snapshot through the typed write and notifies the reviewer', async () => {
    window.location.hash = '#/report/REP-014'
    const h = mountScreenRoute('Alex Morgan')
    h.show(<Editor />)
    await screen.findByLabelText('Content of section Cover Page')
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Review' }))
    await waitFor(() => expect(h.store().db.reports.find((r) => r.id === 'REP-014')!.status).toBe('review'), { timeout: 3000 })
    const rep = h.store().db.reports.find((r) => r.id === 'REP-014')!
    expect(rep.snapshots![0]).toMatchObject({ version: 'v0.3', by: 'Alex Morgan' })
    expect(rep.snapshots![0].bodies['exec']).toContain('During the assessment period')
    expect(h.store().db.notices.some((n) => n.text.includes('REP-014 needs review'))).toBe(true)
    h.unmount()
  })
})

describe('report export/delivery legacy bridge (ticket 37)', () => {
  it('a legacy export action refetches the typed delivery history and the legacy deliver action records the handover', async () => {
    let hist: DeliveryListRead | undefined
    const HistProbe = () => {
      hist = useDeliveryHistory({}).data
      return null
    }
    const h = mountScreenRoute('Alex Morgan', P15)
    h.show(<HistProbe />)
    await waitFor(() => expect(hist).toBeDefined(), { timeout: 3000 })
    expect(hist!.items.some((i) => i.rec.reportId === 'REP-015')).toBe(false)
    // The legacy entry points delegate to the canonical handlers: approve through
    // the legacy action, then export — the handler's export commit publishes the
    // report-export ChangeSet the typed delivery history refetches.
    h.run(() => { h.store().A.approveReport('REP-015') })
    h.run(() => { h.store().A.exportReport('REP-015', 'DOCX') })
    await waitFor(() => expect(hist!.items.some((i) => i.rec.reportId === 'REP-015' && i.rec.version === 'v1.0' && i.rec.format === 'DOCX' && i.rec.status === 'Completed')).toBe(true), { timeout: 3000 })
    const rec = hist!.items.find((i) => i.rec.reportId === 'REP-015')!.rec
    // The checksum lives on the export record (the delivery history), never on preview content.
    expect(rec.checksum).toMatch(/^sha256:[0-9a-f]{4}…[0-9a-f]{4}$/)
    expect(h.store().db.exportsList.some((e) => e.id === rec.id && e.checksum === rec.checksum)).toBe(true)
    // The legacy deliver action goes through the same confirmation-gated handler.
    h.run(() => { h.store().A.deliverReport('REP-015', { recipient: 'Fabrikam Cloud (Demo)', channel: 'Secure portal', notes: '', confirm: true }) })
    await waitFor(() => expect(h.store().db.reports.find((r) => r.id === 'REP-015')!.status).toBe('delivered'), { timeout: 3000 })
    await waitFor(() => expect(hist!.items.some((i) => i.rec.reportId === 'REP-015' && i.rec.status === 'Delivered' && i.rec.deliveredBy === 'Alex Morgan')).toBe(true), { timeout: 3000 })
    h.unmount()
  })
})

/* ───────────── post-write navigation through the single writer (ticket 61e) ───────────── */
/* The report flows navigate through the store's guarded `go` (the dirty-guarded
   single-writer seam) — no raw hash writes on the screens. Rendered regressions
   run the real route host so the destination screen, the URL and the addressed
   report id are all observed after the write commits. */

function RouteProbe({ ready }: { ready: (s: Store) => void }) {
  ready(useStore())
  return null
}

function mountRouterApp(hash: string) {
  window.location.hash = hash
  let store!: Store
  const router = createHashRouter([
    { path: '*', element: <><RouteProbe ready={(s) => { store = s }} /><RouteHost /></>, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <RouterProvider router={router} />
      </ConsoleProviders>
    </StoreProvider>,
  )
  return { view, store: () => store, run: (fn: () => unknown) => act(fn) }
}

describe('report post-write navigation through the guarded seam (ticket 61e)', () => {
  it('submitting from a dirty editor clears the draft state and lands on the review route with the report id — no unsaved modal', async () => {
    const h = mountRouterApp('#/report/REP-014')
    fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
    const box = await screen.findByLabelText('Content of section Cover Page')
    fireEvent.change(box, { target: { value: 'Submitted straight from a dirty editor.' } })
    await waitFor(() => expect(h.store().dirty).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Review' }))
    await waitFor(() => expect(window.location.hash).toBe('#/report-review/REP-014'), { timeout: 3000 })
    expect(h.store().unsaved).toBeNull()
    expect(h.store().route).toEqual({ page: 'report-review', id: 'REP-014' })
    expect((await screen.findAllByText(/Only a Reviewer can approve or return reports/)).length).toBeGreaterThan(0)
    h.view.unmount()
  })

  it('submitting from the preview lands on the review route with the addressed entity', async () => {
    const h = mountRouterApp('#/report-preview/REP-014')
    fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for Review' }))
    await waitFor(() => expect(window.location.hash).toBe('#/report-review/REP-014'), { timeout: 3000 })
    expect(h.store().route).toEqual({ page: 'report-review', id: 'REP-014' })
    expect(await screen.findByText('Review requests')).toBeInTheDocument()
    h.view.unmount()
  })

  it('returning a report from the review route navigates back to the editor route with the report id', async () => {
    const h = mountRouterApp('#/report-review/REP-015')
    fireEvent.click(screen.getByRole('button', { name: /Pat Kim/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Return with Comments' }))
    h.run(() => { h.store().confirmState!.onConfirm('Tighten the executive summary.') })
    await waitFor(() => expect(window.location.hash).toBe('#/report/REP-015'), { timeout: 3000 })
    expect(h.store().route).toEqual({ page: 'report', id: 'REP-015' })
    expect(await screen.findByLabelText('Content of section Cover Page')).toBeInTheDocument()
    expect(h.store().unsaved).toBeNull()
    h.view.unmount()
  })
})
