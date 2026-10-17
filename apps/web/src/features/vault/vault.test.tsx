/**
 * Mock credentials-vault tab: metadata-only list, audited reveal/revoke/store
 * through the mock authority, role gating and demo labeling. The audit trail
 * records are asserted through the same snapshot the Activity & Audit tab
 * reads.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { VaultTab } from './tab'
import type { Project } from '../../domain/entities'

afterEach(() => { cleanup(); window.location.hash = '' })

/** Mounts the vault tab bound to one project. */
function mountVault(me = 'Alex Morgan', projectId = 'RT-2026-014') {
  const p = { id: projectId } as Project
  return mountServices(<VaultTab engagementId={p.id} />, me)
}

describe('mock vault tab', () => {
  it('lists redacted metadata only — the demo plaintext never reaches the DOM before a reveal', async () => {
    const h = mountVault()
    expect(await screen.findByText('SIEM read token (lab)')).toBeInTheDocument()
    expect(screen.getByText('VS-014-01')).toBeInTheDocument()
    expect(screen.getByText(/revealed 2×/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('demo-siem-token-4f2a')
    h.unmount()
  })

  it('reveal is explicit, shows the value in-session and appends an audited record', async () => {
    const h = mountVault()
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal Lab service account' }))
    await waitFor(() => expect(screen.getByText('demo-lab-password')).toBeInTheDocument())
    expect(screen.getByText(/recorded in Activity & Audit|recorded in the project audit log/i)).toBeInTheDocument()
    const audit = h.db().audit.filter((a) => a.obj === 'VS-014-02')
    expect(audit[0]).toMatchObject({ action: 'Revealed vault secret', actor: 'Alex Morgan', projectId: 'RT-2026-014' })
    expect(h.db().vaultSecrets.find((s) => s.id === 'VS-014-02')!.revealCount).toBe(1)
    // Hide removes the value from the session, the list keeps the metadata.
    fireEvent.click(screen.getByRole('button', { name: 'Hide Lab service account' }))
    expect(screen.queryByText('demo-lab-password')).not.toBeInTheDocument()
    h.unmount()
  })

  it('stores a secret through the audited write; the list keeps metadata only', async () => {
    const h = mountVault()
    fireEvent.change(await screen.findByLabelText('Kind'), { target: { value: 'token' } })
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Runner CI token' } })
    fireEvent.change(screen.getByLabelText('Secret value'), { target: { value: 'demo-ci-token' } })
    fireEvent.click(screen.getByRole('button', { name: /Store encrypted/ }))
    await waitFor(() => expect(screen.getByText('Runner CI token')).toBeInTheDocument())
    expect(document.body.textContent).not.toContain('demo-ci-token')
    const audit = h.db().audit.filter((a) => a.action === 'Stored vault secret')
    expect(audit[0]).toMatchObject({ actor: 'Alex Morgan', projectId: 'RT-2026-014' })
    h.unmount()
  })

  it('revokes a secret, drops its material and audits the revocation', async () => {
    const h = mountVault()
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Lab service account' }))
    await waitFor(() => expect(screen.queryByText('Lab service account')).not.toBeInTheDocument())
    expect(h.db().vaultSecrets.find((s) => s.id === 'VS-014-02')).toBeUndefined()
    const audit = h.db().audit.filter((a) => a.obj === 'VS-014-02')
    expect(audit[0]).toMatchObject({ action: 'Revoked vault secret', projectId: 'RT-2026-014' })
    h.unmount()
  })

  it('gates reveal and management by role: an analyst can reveal but not store or revoke', async () => {
    const h = mountVault('Taylor Chen')
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal Lab service account' }))
    await waitFor(() => expect(screen.getByText('demo-lab-password')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Revoke Lab service account' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Store encrypted/ })).toBeDisabled()
    h.unmount()
    const h2 = mountVault('Casey Nguyen (Client)')
    await screen.findByText('SIEM read token (lab)')
    expect(screen.getByRole('button', { name: 'Reveal SIEM read token (lab)' })).toBeDisabled()
    h2.unmount()
  })
})
