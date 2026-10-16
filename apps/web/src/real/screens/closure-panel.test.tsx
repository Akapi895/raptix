/**
 * Ticket 17: the real closure panel reflects the server's authoritative
 * checklist and decision state — a blocked checklist surfaces the refusal
 * naming the failing sources, the closed state renders read-only, and the
 * decision actions target the server contract (never optimistic local state).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchClosure = vi.fn()
const requestClosure = vi.fn()
const decideClosure = vi.fn()
const fetchMembers = vi.fn()

vi.mock('../api', () => ({
  fetchClosure: (...a: unknown[]) => fetchClosure(...a),
  requestClosure: (...a: unknown[]) => requestClosure(...a),
  decideClosure: (...a: unknown[]) => decideClosure(...a),
  fetchMembers: (...a: unknown[]) => fetchMembers(...a),
}))

const SETTLED = {
  engagementId: 'eng-1',
  closure: null,
  checklist: { entries: [{ id: 'reports', state: 'fail', detail: '1 report not delivered' }], ok: false },
  readOnly: false,
  source: 'db',
}

const PENDING = {
  checklist: { entries: [{ id: 'runtime', state: 'pass', detail: 'no in-flight runtime requests' }], ok: true },
  engagementId: 'eng-1',
  closure: {
    id: 'c-1',
    engagementId: 'eng-1',
    status: 'requested',
    requestedBy: 'u-owner',
    decidedBy: null,
    decidedAt: null,
    reason: 'engagement complete',
    checklist: {
      entries: [
        { id: 'runtime', state: 'pass', detail: 'no in-flight runtime requests' },
        { id: 'approvals', state: 'pass', detail: 'no pending approvals' },
      ],
      ok: true,
    },
    createdAt: '2026-10-15T01:00:00.000Z',
    updatedAt: '2026-10-15T01:00:00.000Z',
    source: 'db',
  },
  readOnly: false,
  source: 'db',
}

const CLOSED = {
  checklist: PENDING.checklist,
  engagementId: 'eng-1',
  closure: { ...PENDING.closure, status: 'closed', decidedBy: 'u-reviewer', decidedAt: '2026-10-15T02:00:00.000Z' },
  readOnly: true,
  source: 'db',
}

async function renderPanel(): Promise<void> {
  const { RealClosurePanel } = await import('./closure-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealClosurePanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchClosure.mockReset()
  requestClosure.mockReset()
  decideClosure.mockReset()
  fetchMembers.mockReset()
  fetchMembers.mockResolvedValue({ engagementId: 'eng-1', mode: 'multi-user', members: [{ id: 'u-owner', label: 'Owner Lee', role: 'owner', source: 'membership' }], inviteSupported: true, reason: null, source: 'db' })
})

afterEach(() => {
  cleanup()
})

describe('RealClosurePanel (ticket 17)', () => {
  it('renders the blocked-request refusal naming the failing authoritative sources', async () => {
    fetchClosure.mockResolvedValue(SETTLED)
    requestClosure.mockRejectedValue(new Error('Closure prerequisites are not met: c2 (fail: 1 approved C2 session grant(s) still live); reports (fail: 1 report(s) not delivered).'))
    await renderPanel()
    expect(await screen.findByText('No closure has been requested for this engagement.')).toBeInTheDocument()
    expect(screen.getByText('1 report not delivered')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/reason/i), 'trying to close with live sessions')
    await userEvent.click(screen.getByRole('button', { name: /request closure/i }))
    await waitFor(() => expect(requestClosure).toHaveBeenCalledWith('eng-1', 'trying to close with live sessions'))
    expect(await screen.findByRole('alert')).toHaveTextContent('c2 (fail')
  })

  it('names the requester by their member label rather than the raw user id', async () => {
    fetchClosure.mockResolvedValue(PENDING)
    await renderPanel()
    expect(await screen.findByText('Owner Lee')).toBeInTheDocument()
    expect(screen.queryByText('u-owner')).not.toBeInTheDocument()
  })

  it('shows the pending request with its checklist and submits the independent decision', async () => {
    fetchClosure.mockResolvedValue(PENDING)
    decideClosure.mockResolvedValue(CLOSED.closure)
    await renderPanel()
    expect(await screen.findByText('engagement complete')).toBeInTheDocument()
    expect(screen.getByText('Runtime requests settled')).toBeInTheDocument()
    expect(screen.getByText('requested')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /confirm \(independent\)/i }))
    await waitFor(() => expect(decideClosure).toHaveBeenCalledWith('eng-1', 'confirmed'))
    expect(await screen.findByRole('status')).toHaveTextContent('closed')
  })

  it('renders the closed read-only state without mutation controls', async () => {
    fetchClosure.mockResolvedValue(CLOSED)
    await renderPanel()
    expect(await screen.findByText('This engagement is closed')).toBeInTheDocument()
    expect(screen.getByText('closed')).toBeInTheDocument()
    expect(screen.getByText('u-reviewer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /request closure/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
  })
})
