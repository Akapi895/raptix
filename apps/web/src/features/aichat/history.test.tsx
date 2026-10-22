/**
 * Ticket 42: conversation history & provenance on typed reads — the archive
 * read model (src/features/aichat/history.ts) and the migrated history
 * screen (src/features/trace/views/ai-trace-pages.tsx, AiHistory).
 *
 * Covered here: the history read is scope-checked per project (a
 * specific-project read works only for members; the aggregate reads only the
 * actor's accessible projects and never merges foreign conversations);
 * archived message text is masked at the boundary (credentials, tokens, IP
 * literals) while the stored record is never rewritten; search, the
 * actor-type filter and audit pagination apply inside the handler with
 * search-independent counts; the audit inspector resolves same-correlation
 * related events and refuses foreign rows without leaking; and the rendered
 * route pins/unpins through the typed chat handler, refetches on plan
 * commits, keeps raw values out of the DOM (including the provenance
 * drawer), wires its filters to the typed read and renders refusal and
 * empty states.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { selectProject } from '../../router/navigate'
import { revisePlanTransaction } from '../plans/service'
import { createConsoleServices } from '../../demo/services';
import type { ActorRef, RequestContext } from '../../domain/service'
import { seed } from '../../demo/seed';
import { AiHistory } from '../trace/views/ai-trace-pages'
import { getAiHistoryRow, listAiHistory } from './history'

afterEach(() => { cleanup(); window.location.hash = '' })

const TAYLOR: ActorRef = { id: 'Taylor Chen', role: 'operator' }
const RILEY: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
let corrSeq = 0
const ctx = (actor: ActorRef, projectId = 'all'): RequestContext => ({ actor, projectId, corr: `corr-${++corrSeq}` })

/** Mounts the providers with the history route for one persona/project scope. */
function mountHistory(me = 'Taylor Chen', projectId = 'RT-2026-014') {
  window.location.hash = '#/ai-history'
  const h = mountServices(<AiHistory />, me)
  act(() => { selectProject(projectId) })
  return h
}

describe('history read model scope (ticket 42)', () => {
  it('reads a specific project only for members and aggregates only accessible projects', () => {
    const db = seed()
    const riley = listAiHistory(db, ctx(RILEY, 'RT-2026-014'))
    expect(riley.ok).toBe(true)
    if (!riley.ok) return
    expect(riley.data.projectId).toBe('RT-2026-014')
    expect(riley.data.conversations.map((h) => h.conversation.id)).toEqual(['CV-014-03', 'CV-014-01'])
    expect(riley.data.plans.map((p) => p.id)).toEqual(['PL-021', 'PL-020'])
    // Scope counts mirror the project's own audit rows (the toggle's numbers).
    const scoped = db.audit.filter((a) => a.projectId === 'RT-2026-014')
    expect(riley.data.counts.all).toBe(scoped.length)
    expect(riley.data.counts.ai).toBe(scoped.filter((a) => a.actor === 'AI Operator' || /AI plan|plan|tool|Blocked/i.test(a.action)).length)
    // The pinned conversation keeps its flag; provenance derives from the same snapshot.
    const pinned = riley.data.conversations.find((h) => h.conversation.id === 'CV-014-03')!
    expect(pinned.conversation.pinned).toBe(true)
    expect(pinned.plans.map((p) => p.id)).toEqual(['PL-020', 'PL-021'])
    expect(pinned.toolApprovals.length).toBeGreaterThan(0)
    expect(riley.data.context.roeVersion).toBe('ROE-014-v2')
    // A non-member read is not-found without leaking the project.
    const foreign = listAiHistory(db, ctx(RILEY, 'RT-2026-015'))
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) {
      expect(foreign.failure.kind).toBe('not-found')
      expect(foreign.failure.message).toContain('not available for your account')
      expect(foreign.failure.message).not.toContain('Cloud Security Assessment')
    }
    // The aggregate merges only the actor's accessible projects (Riley: RT-2026-014).
    const agg = listAiHistory(db, ctx(RILEY))
    expect(agg.ok).toBe(true)
    if (!agg.ok) return
    expect(agg.data.projectId).toBe('all')
    expect(agg.data.conversations.map((h) => h.conversation.id)).toEqual(['CV-014-03', 'CV-014-01'])
    expect(agg.data.conversations.some((h) => h.conversation.projectId !== 'RT-2026-014')).toBe(false)
  })

  it('masks credentials, tokens and IP literals in the archive without rewriting the stored record', async () => {
    const svc = createConsoleServices()
    const sent = svc.chat(TAYLOR, 'RT-2026-014').send(ctx(TAYLOR, 'RT-2026-014'), 'CV-014-03', 'Rotating the lab credentials: password=hunter2 for host 10.0.0.7 with token=abc123.')
    expect(sent.ok).toBe(true)
    const res = await svc.aiHistory(TAYLOR, 'RT-2026-014').list(ctx(TAYLOR, 'RT-2026-014'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const hc = res.data.conversations.find((h) => h.conversation.id === 'CV-014-03')!
    const masked = hc.conversation.messages.map((m) => m.text).find((t) => t.includes('password='))
    expect(masked).toContain('password=[redacted]')
    expect(masked).toContain('[ip redacted]')
    expect(masked).toContain('token=[redacted]')
    expect(masked).not.toContain('hunter2')
    expect(masked).not.toContain('10.0.0.7')
    expect(masked).not.toContain('abc123')
    // The stored record keeps the raw text — masking is presentation-only.
    const stored = svc.authority.snapshot().conversations.find((c) => c.id === 'CV-014-03')!
    expect(stored.messages.some((m) => m.text.includes('hunter2'))).toBe(true)
    svc.dispose()
  })

  it('applies search, the actor-type filter and pagination inside the handler; counts stay search-independent', () => {
    const db = seed()
    const all = listAiHistory(db, ctx(TAYLOR, 'RT-2026-014'))
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.data.audit.total).toBe(5)
    // Search narrows the audit page, never the scope counts.
    const q = listAiHistory(db, ctx(TAYLOR, 'RT-2026-014'), { q: 'PL-021' })
    expect(q.ok).toBe(true)
    if (!q.ok) return
    expect(q.data.audit.total).toBe(1)
    expect(q.data.audit.items.map((r) => r.audit.id)).toEqual(['AU-4'])
    expect(q.data.counts).toEqual(all.data.counts)
    // The actor-type filter derives from the one audit record.
    const human = listAiHistory(db, ctx(TAYLOR, 'RT-2026-014'), { actorType: 'Human' })
    expect(human.ok).toBe(true)
    if (!human.ok) return
    expect(human.data.audit.total).toBe(4)
    expect(human.data.audit.items.every((r) => r.actorType === 'Human')).toBe(true)
    // Pagination slices inside the handler; pages do not overlap.
    const p1 = listAiHistory(db, ctx(TAYLOR, 'RT-2026-014'), { page: { page: 1, pageSize: 2 } })
    const p2 = listAiHistory(db, ctx(TAYLOR, 'RT-2026-014'), { page: { page: 2, pageSize: 2 } })
    expect(p1.ok && p2.ok).toBe(true)
    if (!p1.ok || !p2.ok) return
    expect(p1.data.audit.items).toHaveLength(2)
    expect(p1.data.audit.page).toBe(1)
    expect(p2.data.audit.items).toHaveLength(2)
    const ids1 = p1.data.audit.items.map((r) => r.audit.id)
    expect(ids1.some((id) => p2.data.audit.items.some((r) => r.audit.id === id))).toBe(false)
  })

  it('the audit inspector links same-correlation events and refuses foreign rows', () => {
    const db = seed()
    const row = getAiHistoryRow(db, ctx(TAYLOR), 'AU-4')
    expect(row.ok).toBe(true)
    if (!row.ok) return
    expect(row.data.actorType).toBe('Human')
    expect(row.data.eventType).toBe('AI plan decision')
    expect(row.data.related!.audits.map((x) => x.id).sort()).toEqual(['AU-1', 'AU-2', 'AU-3', 'AU-5'])
    expect(row.data.related!.tools.map((x) => x.id)).toEqual(['TL-01'])
    // A row from an inaccessible project is not-found; the message names only the id.
    const foreign = getAiHistoryRow(db, ctx(RILEY), 'AU-6')
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) {
      expect(foreign.failure.kind).toBe('not-found')
      expect(foreign.failure.message).toContain('AU-6')
      expect(foreign.failure.message).not.toContain('Cloud configuration validation')
    }
    // A specific-project request for another project's row names the owning project.
    const cross = getAiHistoryRow(db, ctx(TAYLOR, 'RT-2026-015'), 'AU-4')
    expect(cross.ok).toBe(false)
    if (!cross.ok) {
      expect(cross.failure.kind).toBe('forbidden')
      expect(cross.failure.message).toContain('RT-2026-014')
    }
  })
})

describe('history screen on the typed read (ticket 42)', () => {
  it('pins and unpins through the typed chat handler and refetches the archive on plan commits', async () => {
    const h = mountHistory('Taylor Chen', 'RT-2026-014')
    await waitFor(() => expect(screen.getByText('PL-021')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /Conversations/ }))
    const row = () => screen.getByText('CV-014-03').closest('tr')!
    await waitFor(() => expect(within(row()).getByRole('button', { name: 'Unpin Plan internal discovery' })).toBeInTheDocument())
    // The pin goes through the typed setPinned write; the committed ChangeSet refetches the archive.
    fireEvent.click(within(row()).getByRole('button', { name: 'Unpin Plan internal discovery' }))
    await waitFor(() => expect(within(row()).getByRole('button', { name: 'Pin Plan internal discovery' })).toBeInTheDocument())
    // A legacy revision commits; the archive refetches — the revision's audit row names the new plan.
    h.run(() => { expect(revisePlanTransaction(h.svc().authority, h.svc().clock, ctx(TAYLOR), 'PL-021', ['Add an approval gate to step 3'], 'tighten gates').ok).toBe(true) })
    await waitFor(() => expect(screen.getByRole('tab', { name: /AI Audit/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /AI Audit/ }))
    await waitFor(() => expect(screen.getAllByText('PL-024').length).toBeGreaterThan(0))
    h.unmount()
  })

  it('keeps raw credentials and IP literals out of the DOM, including the provenance drawer', async () => {
    const h = mountHistory('Taylor Chen', 'RT-2026-014')
    await waitFor(() => expect(screen.getByText('PL-021')).toBeInTheDocument())
    h.run(() => { h.svc().chat(TAYLOR, 'RT-2026-014').send(ctx(TAYLOR, 'RT-2026-014'), 'CV-014-03', 'Rotating the lab credentials: password=hunter2 for host 10.0.0.7 with token=abc123.') })
    fireEvent.click(screen.getByRole('tab', { name: /Conversations/ }))
    const row = () => screen.getByText('CV-014-03').closest('tr')!
    await waitFor(() => expect(within(row()).getByRole('button', { name: 'View Provenance' })).toBeInTheDocument())
    fireEvent.click(within(row()).getByRole('button', { name: 'View Provenance' }))
    const drawer = await screen.findByRole('dialog', { name: 'Provenance — Plan internal discovery' })
    await waitFor(() => expect(within(drawer).getByText(/password=\[redacted\]/)).toBeInTheDocument())
    expect(within(drawer).getByText(/\[ip redacted\]/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('hunter2')
    expect(document.body.textContent).not.toContain('10.0.0.7')
    expect(document.body.textContent).not.toContain('abc123')
    h.unmount()
  })

  it('wires the audit filters to the typed read, opens the inspector and renders the pagination footer', async () => {
    const h = mountHistory('Taylor Chen', 'RT-2026-014')
    await waitFor(() => expect(screen.getByText('PL-021')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /AI Audit/ }))
    // Default AI-related scope: the AI plan decision and the blocked tool call only.
    await waitFor(() => expect(screen.getByText('AU-4')).toBeInTheDocument())
    expect(screen.getByText('AU-5')).toBeInTheDocument()
    expect(screen.queryByText('AU-1')).not.toBeInTheDocument()
    // The actor-type select swaps the keyed read; the combined filter keeps the human plan decision.
    fireEvent.change(screen.getByLabelText('Actor type'), { target: { value: 'Human' } })
    await waitFor(() => expect(screen.getByText('AU-4')).toBeInTheDocument())
    expect(screen.queryByText('AU-5')).not.toBeInTheDocument()
    // The all-events scope exposes every project row; the inspector links same-correlation events.
    fireEvent.click(screen.getByRole('button', { name: /All project events/ }))
    await waitFor(() => expect(screen.getByText('AU-1')).toBeInTheDocument())
    fireEvent.click(screen.getByText('AU-4'))
    const insp = await screen.findByRole('dialog', { name: 'Audit Inspector — AU-4' })
    expect(within(insp).getByText('Related events')).toBeInTheDocument()
    expect(within(insp).getByText('AU-1')).toBeInTheDocument()
    fireEvent.click(within(insp).getAllByRole('button', { name: 'Close' })[0]!)
    // Search narrows the project rows inside the typed read.
    fireEvent.change(screen.getByPlaceholderText('Search event, actor, object, correlation'), { target: { value: 'session access' } })
    await waitFor(() => expect(screen.getByText('AU-1')).toBeInTheDocument())
    expect(screen.getByText('AU-2')).toBeInTheDocument()
    expect(screen.queryByText('AU-3')).not.toBeInTheDocument()
    expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument()
    h.unmount()
  })

  it('renders the refusal state for a non-member project and the empty state for a planless project', async () => {
    const h = mountHistory('Riley Brooks', 'RT-2026-015')
    await waitFor(() => expect(screen.getByText('Could not load history')).toBeInTheDocument())
    expect(screen.getByText(/not available for your account/)).toBeInTheDocument()
    expect(screen.queryByText('PL-021')).not.toBeInTheDocument()
    h.unmount()
    const h2 = mountHistory('Pat Kim', 'RT-2026-009')
    await waitFor(() => expect(screen.getByText('No AI plans yet')).toBeInTheDocument())
    h2.unmount()
  })
})
