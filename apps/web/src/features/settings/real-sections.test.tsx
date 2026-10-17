/**
 * The real-mode settings sections keep the data classes honest: workspace
 * settings are versioned persisted values with a required reason and a shown
 * conflict, the workspace audit attributes what the records carry (vault rows
 * have no actor), and UI-only preferences are labelled browser-local.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchWorkspaceSettings = vi.fn()
const saveWorkspaceSetting = vi.fn()
const fetchWorkspaceAudit = vi.fn()

vi.mock('../../real/api', () => ({
  fetchWorkspaceSettings: (...a: unknown[]) => fetchWorkspaceSettings(...a),
  saveWorkspaceSetting: (...a: unknown[]) => saveWorkspaceSetting(...a),
  fetchWorkspaceAudit: (...a: unknown[]) => fetchWorkspaceAudit(...a),
  fetchCapabilities: vi.fn(),
}))

const SETTINGS_VIEW = {
  settings: [
    { key: 'policy.c2_grant_max_hours', kind: 'policy', value: 24, version: 1, updatedBy: null, updatedAt: null, consumer: 'c2-grants', enforcement: 'Enforced on every grant request.', description: 'Maximum C2 grant length.' },
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

async function renderSection(which: 'policy' | 'audit' | 'org'): Promise<void> {
  const sections = await import('./real-sections')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const node = which === 'policy' ? <sections.WorkspaceSettingsSection kind="policy" /> : which === 'audit' ? <sections.WorkspaceAuditSection /> : <sections.RealOrganizationSection />
  render(node, { wrapper })
}

beforeEach(() => {
  fetchWorkspaceSettings.mockReset()
  saveWorkspaceSetting.mockReset()
  fetchWorkspaceAudit.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('real settings sections', () => {
  it('labels UI-only preferences as browser-local and says the organization registry is not modelled', async () => {
    await renderSection('org')
    expect(await screen.findByText('UI-only preferences stay in this browser')).toBeInTheDocument()
    expect(screen.getByText('Engagement settings')).toBeInTheDocument()
    expect(screen.getByText(/no organization-level member registry/i)).toBeInTheDocument()
  })

  it('saves a versioned policy change with its audited reason', async () => {
    fetchWorkspaceSettings.mockResolvedValue(SETTINGS_VIEW)
    saveWorkspaceSetting.mockResolvedValue({ ...SETTINGS_VIEW.settings[0], value: 2, version: 2 })
    await renderSection('policy')
    expect(await screen.findByText('policy.c2_grant_max_hours')).toBeInTheDocument()
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
    await renderSection('policy')
    await screen.findByText('policy.c2_grant_max_hours')
    await userEvent.type(screen.getByLabelText(/new value/i), '2')
    await userEvent.type(screen.getByLabelText(/reason/i), 'stale write')
    await userEvent.click(screen.getByRole('button', { name: /save \(version 1 → 2\)/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Version conflict')
  })

  it('projects the workspace audit with truthful attribution and re-queries with the action filter', async () => {
    fetchWorkspaceAudit.mockResolvedValue(AUDIT_VIEW)
    await renderSection('audit')
    expect(await screen.findByText('scope.revision_approved')).toBeInTheDocument()
    expect(screen.getByText('u-1')).toBeInTheDocument()
    expect(screen.getByText('vault.secret_revealed')).toBeInTheDocument()
    expect(screen.getByText('not recorded')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/filter by action prefix/i), 'scope.')
    await waitFor(() => expect(fetchWorkspaceAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'scope.' })))
  })
})
