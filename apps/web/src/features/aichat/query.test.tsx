/**
 * Ticket 38: AI chat + plan proposals on typed services — the proposal
 * invariant (execution.md requirement 5) at its new enforcement site
 * (src/features/aichat/service.ts).
 *
 * Covered here: chat send persists through the one authority and the legacy
 * conversation consumer sees it; proposals land only as draft/proposed; the
 * chat service exposes no execution capability and an execution request (even
 * in Approved Execution mode) creates nothing execution-shaped; mode
 * selection is display intent only and cannot grant authorization;
 * send/cancel/reset and late responses respect the captured actor/project
 * and dispose timers; Observe/Propose/Execution render as display-only
 * modes; out-of-scope requests are blocked without cross-project data
 * leakage; conversation read scope semantics.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { selectProject } from '../../router/navigate'
import { resetDemo, sendChat, stopChat } from '../../demo/runtime'
import { requestPlanReviewTransaction } from '../plans/service'
import type { ActorRef, RequestContext } from '../../domain/service'
import type { Db } from '../../demo/seed';
import { AiOperator } from '../../screens/g-chat'
import { seed } from '../../demo/seed';
import { getConversation, listConversations } from './service'

afterEach(() => { cleanup(); window.location.hash = '' })

/** Mounts the providers (optionally with the AI workspace screen) and a probe. */
function mountChat(me = 'Sam Patel', withScreen = false) {
  return mountServices(withScreen ? <AiOperator /> : null, me)
}

const sam = (): ActorRef => ({ id: 'Sam Patel', role: 'manager' })
const ctx = (actor: ActorRef, projectId = 'all', corr = 't'): RequestContext => ({ actor, projectId, corr })

const executionShape = (d: Db) =>
  JSON.stringify({
    plans: d.plans.map((p) => [p.id, p.status]),
    operations: d.operations.map((o) => [o.id, o.status]),
    toolEvents: d.toolEvents.map((t) => [t.id, t.state]),
    approvals: d.approvals.map((a) => a.id),
  })

describe('AI chat on typed services (ticket 38)', () => {
  it('chat send persists through the authority and the legacy conversation consumer sees it (bridge proof)', () => {
    const h = mountChat()
    const chat = h.svc().chat(sam(), 'RT-2026-015')
    const created = h.run(() => chat.create(ctx(sam(), 'RT-2026-015'), 'RT-2026-015', 'propose'))
    expect(created.ok).toBe(true)
    const convId = created.ok ? created.data.id : ''
    expect(convId).toBe('CV-015-02')
    const sent = h.run(() => chat.send(ctx(sam()), convId, 'Plan a validation run for the in-scope cloud assets.'))
    expect(sent.ok).toBe(true)
    // The legacy store projection (rail, thread, history consumers) observes the write.
    const conv = h.db().conversations.find((c) => c.id === convId)!
    expect(conv.messages).toHaveLength(1)
    expect(conv.messages[0]).toMatchObject({ role: 'user', text: 'Plan a validation run for the in-scope cloud assets.' })
    expect(conv.title.startsWith('Plan a validation run')).toBe(true)
    const responded = h.run(() => chat.respond(ctx(sam()), convId, 'Plan a validation run for the in-scope cloud assets.'))
    expect(responded.ok).toBe(true)
    const d = h.db()
    expect(d.conversations.find((c) => c.id === convId)!.messages).toHaveLength(2)
    expect(d.conversations.find((c) => c.id === convId)!.messages[1]!.planId).toBe(d.plans[0]!.id)
    h.unmount()
  })

  it('proposals land only as draft/proposed — never approved or executed', () => {
    const h = mountChat()
    const svc = h.svc()
    expect(h.run(() => svc.chat(sam(), 'RT-2026-015').respond(ctx(sam(), 'RT-2026-015'), 'CV-015-01', 'Plan a validation run for the in-scope cloud assets.')).ok).toBe(true)
    expect(h.run(() => svc.chat(sam(), 'RT-2026-017').respond(ctx(sam(), 'RT-2026-017'), 'CV-017-01', 'Plan a discovery run for the lab hosts.')).ok).toBe(true)
    const d = h.db()
    const fromChat = d.plans.filter((p) => (p.conversationId === 'CV-015-01' || p.conversationId === 'CV-017-01') && p.id !== 'PL-022')
    expect(fromChat).toHaveLength(2) // one per conversation above
    expect(fromChat.map((p) => p.status).sort()).toEqual(['draft', 'proposed'])
    expect(fromChat.find((p) => p.status === 'draft')!.risks.join(' ')).toContain('ROE is not approved')
    // Chat-created plans are unbound: no operation exists for them.
    expect(fromChat.every((p) => !p.opId && !d.operations.some((o) => o.planId === p.id))).toBe(true)
    h.unmount()
  })

  it('the chat service surface has no execution path and an execution request in Approved Execution mode creates nothing', () => {
    const h = mountChat()
    const chat = h.svc().chat(sam(), 'RT-2026-015')
    // Invariant 5 asserted on the surface: only proposal-shaped capabilities exist.
    expect(Object.keys(chat).sort()).toEqual(['create', 'get', 'list', 'respond', 'send', 'setMode', 'setPinned', 'stop'])
    const created = h.run(() => chat.create(ctx(sam(), 'RT-2026-015'), 'RT-2026-015', 'execution'))
    const convId = created.ok ? created.data.id : ''
    const before = executionShape(h.db())
    const res = h.run(() => chat.respond(ctx(sam()), convId, 'Execute the approved plan right now.'))
    expect(res.ok).toBe(true)
    expect(res.ok && res.data.messages.at(-1)!.text).toContain('no approved plan waiting to run')
    expect(executionShape(h.db())).toBe(before) // nothing execution-shaped changed
    h.unmount()
  })

  it('mode selection cannot grant authorization: flipping modes commits the preference and nothing else', () => {
    const h = mountChat()
    const chat = h.svc().chat(sam(), 'RT-2026-015')
    const created = h.run(() => chat.create(ctx(sam(), 'RT-2026-015'), 'RT-2026-015', 'observe'))
    const convId = created.ok ? created.data.id : ''
    const before = executionShape(h.db())
    const res = h.run(() => chat.setMode(ctx(sam()), convId, 'execution'))
    expect(res.ok).toBe(true)
    expect(h.db().conversations.find((c) => c.id === convId)!.mode).toBe('execution')
    expect(executionShape(h.db())).toBe(before)
    // A non-member cannot even address the conversation to flip its mode.
    const riley: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
    const denied = h.run(() => h.svc().chat(riley, 'all').setMode(ctx(riley), convId, 'execution'))
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.failure.kind).toBe('not-found')
    h.unmount()
  })

  it('stop cancels the pending response and records the stop; no late response is applied', async () => {
    const h = mountChat()
    const created = h.run(() => h.svc().chat(sam(), 'RT-2026-015').create(ctx(sam(), 'RT-2026-015'), 'RT-2026-015', 'propose'))
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.failure.message)
    const convId = created.data.id
    h.run(() => sendChat(convId, 'Plan a validation run for the in-scope cloud assets.'))
    expect(h.db().conversations.find((c) => c.id === convId)!.messages).toHaveLength(1)
    h.run(() => stopChat(convId))
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)) })
    const messages = h.db().conversations.find((c) => c.id === convId)!.messages
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ role: 'system', text: 'Response generation stopped by Sam Patel.' })
    h.unmount()
  })

  it('a late response lands in the conversation it was sent to, never in the newly selected project', async () => {
    const h = mountChat()
    const created = h.run(() => h.svc().chat(sam(), 'RT-2026-015').create(ctx(sam(), 'RT-2026-015'), 'RT-2026-015', 'propose'))
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.failure.message)
    const convId = created.data.id
    h.run(() => sendChat(convId, 'Plan a validation run for the in-scope cloud assets.'))
    const before14 = JSON.stringify(h.db().conversations.filter((c) => c.projectId === 'RT-2026-014').map((c) => c.messages.length))
    h.run(() => selectProject('RT-2026-014')) // switch while the response is pending
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)) })
    const d = h.db()
    expect(d.conversations.find((c) => c.id === convId)!.messages.at(-1)!.role).toBe('ai')
    expect(d.conversations.find((c) => c.id === convId)!.projectId).toBe('RT-2026-015')
    expect(JSON.stringify(d.conversations.filter((c) => c.projectId === 'RT-2026-014').map((c) => c.messages.length))).toBe(before14)
    h.unmount()
  })

  it('demo reset disposes a pending response: the reseeded dataset is never touched by it', async () => {
    const h = mountChat()
    const created = h.run(() => h.svc().chat(sam(), 'RT-2026-015').create(ctx(sam(), 'RT-2026-015'), 'RT-2026-015', 'propose'))
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.failure.message)
    const convId = created.data.id
    h.run(() => sendChat(convId, 'Plan a validation run for the in-scope cloud assets.'))
    h.run(() => resetDemo())
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)) })
    expect(h.db().conversations.find((c) => c.id === 'CV-014-03')!.messages).toHaveLength(12)
    expect(h.db().conversations.find((c) => c.id === convId)).toBeUndefined()
    h.unmount()
  })

  it('out-of-scope requests produce blocked proposals without cross-project data leakage', () => {
    const h = mountChat()
    const chat = h.svc().chat(sam(), 'RT-2026-014')
    const tools = h.db().toolEvents.length
    const out = h.run(() => chat.respond(ctx(sam(), 'RT-2026-014'), 'CV-014-01', 'Scan prod-payments-db too.'))
    expect(out.ok).toBe(true)
    const d = h.db()
    expect(d.toolEvents).toHaveLength(tools + 1)
    expect(d.toolEvents[0]).toMatchObject({ state: 'denied', target: 'prod-payments-db' })
    expect(d.audit[0]!.action).toBe('Blocked tool call')
    // Cross-project request: the reply names only the current project, no foreign data.
    const cross = h.run(() => chat.respond(ctx(sam(), 'RT-2026-014'), 'CV-014-01', 'What is running in RT-2026-009 right now?'))
    expect(cross.ok).toBe(true)
    const text = cross.ok ? cross.data.messages.at(-1)!.text : ''
    expect(text).toContain('RT-2026-014')
    expect(text).not.toContain('RT-2026-009')
    expect(text).not.toContain('Contoso')
    expect(d.toolEvents[0]!.state).toBe('denied')
    h.unmount()
  })

  it('observe mode stays read-only at the handler: an answer, no plan and no tool event', () => {
    const h = mountChat()
    const before = executionShape(h.db())
    const res = h.run(() => h.svc().chat(sam(), 'RT-2026-014').respond(ctx(sam(), 'RT-2026-014'), 'CV-014-01', 'Plan an assessment for me.'))
    expect(res.ok).toBe(true)
    expect(res.ok && res.data.messages.at(-1)!.text).toContain('Observe mode — read-only')
    expect(executionShape(h.db())).toBe(before)
    h.unmount()
  })

  it('a chat proposal enters the legacy plan review lifecycle and updates canonical history/notices', () => {
    const h = mountChat()
    const res = h.run(() => h.svc().chat(sam(), 'RT-2026-015').respond(ctx(sam(), 'RT-2026-015'), 'CV-015-01', 'Plan a validation run for the in-scope cloud assets.'))
    const planId = res.ok ? res.data.messages.at(-1)!.planId! : ''
    h.run(() => { expect(requestPlanReviewTransaction(h.svc().authority, h.svc().clock, ctx(sam(), 'RT-2026-015'), planId).ok).toBe(true) })
    const d = h.db()
    expect(d.plans.find((p) => p.id === planId)!.status).toBe('in_review')
    expect(d.conversations.find((c) => c.id === 'CV-015-01')!.messages.at(-1)!.text).toContain('sent to Pat Kim for approval')
    expect(d.notices.some((n) => n.text.includes(`${planId} needs review`))).toBe(true)
    h.unmount()
  })
})

describe('conversation read scope (ticket 38)', () => {
  it('denies a non-member specific-project read without leaking existence', () => {
    const riley: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
    const res = listConversations(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('aggregates only accessible projects, newest first', () => {
    const riley: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
    const res = listConversations(seed(), { actor: riley, projectId: 'all', corr: 't' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.conversations.map((c) => c.projectId)).toEqual(['RT-2026-014', 'RT-2026-014'])
  })

  it('refuses a cross-context detail read with the owning project and no content', () => {
    const taylor: ActorRef = { id: 'Taylor Chen', role: 'operator' }
    const res = getConversation(seed(), { actor: taylor, projectId: 'RT-2026-015', corr: 't' }, 'CV-014-03')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('forbidden')
      expect(res.failure.entity?.projectId).toBe('RT-2026-014')
      expect(res.failure.message).not.toContain('Plan internal discovery')
    }
  })

  it('reports a missing or out-of-scope conversation as not-found without content', () => {
    const riley: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
    const res = getConversation(seed(), { actor: riley, projectId: 'all', corr: 't' }, 'CV-015-01')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('not-found')
      expect(res.failure.message).not.toContain('Cloud configuration validation')
    }
  })
})

describe('AI workspace rendering (ticket 38)', () => {
  it('renders Observe/Propose/Execution as display-only modes; execution mode enables no execution control', async () => {
    window.location.hash = '#/ai-operator'
    const h = mountChat('Sam Patel', true)
    h.run(() => selectProject('RT-2026-015'))
    await waitFor(() => expect(screen.getByText('Cloud configuration validation')).toBeInTheDocument())
    const group = screen.getByRole('radiogroup', { name: 'Conversation mode' })
    expect(within(group).getByRole('radio', { name: 'Observe' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'Propose' })).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('radio', { name: 'Approved Execution' })).toBeInTheDocument()
    expect(screen.getByText(/Applies to this conversation only; it does not grant permission/)).toBeInTheDocument()
    // Mode selection is display intent: switching commits a preference, never an execution grant.
    fireEvent.click(within(group).getByRole('radio', { name: 'Approved Execution' }))
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'Approved Execution' })).toHaveAttribute('aria-checked', 'true'))
    expect(screen.queryByRole('button', { name: /execute|start/i })).not.toBeInTheDocument()
    // A chat proposal renders as a plan card with the proposal badge through the Query view.
    h.run(() => { h.svc().chat(sam(), 'all').respond(ctx(sam()), 'CV-015-01', 'Plan a validation run for the in-scope cloud assets.') })
    await waitFor(() => expect(screen.getAllByText('Proposal — not executed').length).toBeGreaterThan(0))
    h.unmount()
  })
})
