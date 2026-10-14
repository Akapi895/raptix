/**
 * Ticket 16: the real settings surface distinguishes its data classes and
 * never fakes authority — workspace settings are versioned persisted
 * contracts (conflicts surface the server's message), the audit tab projects
 * records with truthful attribution (vault rows carry no fabricated actor),
 * and UI-only preferences are labelled browser-local.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchWorkspaceSettings = vi.fn()
const saveWorkspaceSetting = vi.fn()
const fetchWorkspaceAudit = vi.fn()
const fetchCapabilities = vi.fn()

vi.mock('../api', () => ({
  fetchWorkspaceSettings: (...a: unknown[]) => fetchWorkspaceSettings(...a),
  saveWorkspaceSetting: (...a: unknown[]) => saveWorkspaceSetting(...a),
  fetchWorkspaceAudit: (...a: unknown[]) => fetchWorkspaceAudit(...a),
  fetchCapabilities: (...a: unknown[]) => fetchCapabilities(...a),
}))

const SETTINGS_VIEW = {
  settings: [
    { key: 'policy.c2_grant_max_hours', kind: 'policy', value: 24, version: 1, updatedBy: null, updatedAt: null, consumer: 'c2-grants', enforcement: 'Enforced on every grant request.', description: 'Maximum C2 session grant window in hours.' },
    { key: 'retention.audit_retention_days', kind: 'retention', value: 365, version: 1, updatedBy: 'u-owner', updatedAt: '2026-10-15T00:00:00.000Z', consumer: null, enforcement: 'Configuration only: no scheduled retention enforcement.', description: 'Intended web audit retention in days.' },
  ],
  source: 'db',
}

const AUDIT_VIEW = {
  engagementId: null,
  entries: [
    { id: 'a-1', engagementId: 'eng-1', actorId: 'u-1', action: 'scope.revision_approved', targetType: 'scope_revision', targetId: 'r1', reason: 'ok', createdAt: '2026-10-15T01:00:00.000Z', source: 'web' },
    { id: 'va-1', engagementId: 'eng-1', actorId: null, action: 'vault.secret_revealed', targetType: 'vault_secret', targetId: 'sec-1', reason: null, createdAt: '2026-10-15T02:00:00.000Z', source: 'vault' },
  ],
  total: 2,
  truncated: false,
  actors: ['u-1'],
  actions: ['scope.revision_approved', 'vault.secret_revealed'],
  source: 'db',
}

async function renderSettings(tab?: string): Promise<void> {
  const { navRawRoute } = await import('../../router/navigate')
  navRawRoute({ page: 'settings', ...(tab !== undefined ? { tab } : {}) })
  const { RealSettings } = await import('./settings')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealSettings />, { wrapper })
}

beforeEach(() => {
  fetchWorkspaceSettings.mockReset()
  saveWorkspaceSetting.mockReset()
  fetchWorkspaceAudit.mockReset()
  fetchCapabilities.mockReset()
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('RealSettings (ticket 16)', () => {
  it('labels UI-only preferences as browser-local and separates persisted classes', async () => {
    await renderSettings('profile')
    expect(await screen.findByRole('status')).toHaveTextContent('UI-only preferences stay in this browser')
    expect(screen.getByText('Local Operator')).toBeInTheDocument()
    expect(screen.getByText('Engagement settings')).toBeInTheDocument()
  })

  it('shows persisted policy values with consumer truth and saves a versioned change with the audited reason', async () => {
    fetchWorkspaceSettings.mockResolvedValue(SETTINGS_VIEW)
    saveWorkspaceSetting.mockResolvedValue({ ...SETTINGS_VIEW.settings[0], value: 2, version: 2, updatedBy: 'u-1' })
    await renderSettings('policies')
    expect(await screen.findByText('policy.c2_grant_max_hours')).toBeInTheDocument()
    expect(screen.getByText('c2-grants')).toBeInTheDocument()
    const value = screen.getByLabelText(/new value/i)
    await userEvent.clear(value)
    await userEvent.type(value, '2')
    await userEvent.type(screen.getByLabelText(/reason/i), 'shorter windows')
    await userEvent.click(screen.getByRole('button', { name: /save \(version 1 → 2\)/i }))
    await waitFor(() => expect(saveWorkspaceSetting).toHaveBeenCalledWith('policy.c2_grant_max_hours', { value: 2, expectedVersion: 1, reason: 'shorter windows' }))
    expect(await screen.findByRole('status')).toHaveTextContent('saved')
  })

  it('surfaces the server conflict message instead of faking a save', async () => {
    fetchWorkspaceSettings.mockResolvedValue(SETTINGS_VIEW)
    saveWorkspaceSetting.mockRejectedValue(new Error('Version conflict: policy.c2_grant_max_hours is at version 2, not 1. Reload and retry.'))
    await renderSettings('policies')
    await screen.findByText('policy.c2_grant_max_hours')
    await userEvent.type(screen.getByLabelText(/new value/i), '2')
    await userEvent.type(screen.getByLabelText(/reason/i), 'stale write')
    await userEvent.click(screen.getByRole('button', { name: /save \(version 1 → 2\)/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Version conflict')
  })

  it('projects the audit with truthful attribution and re-queries with filters', async () => {
    fetchWorkspaceAudit.mockResolvedValue(AUDIT_VIEW)
    await renderSettings('audit')
    expect(await screen.findByText('scope.revision_approved')).toBeInTheDocument()
    expect(screen.getByText('u-1')).toBeInTheDocument()
    // The vault row has no actor on record; the surface says so instead of inventing one.
    expect(screen.getByText('vault.secret_revealed')).toBeInTheDocument()
    expect(screen.getByText('not recorded')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/filter by action prefix/i), 'scope.')
    await waitFor(() => expect(fetchWorkspaceAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'scope.' })))
  })
})
