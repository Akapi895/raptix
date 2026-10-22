/**
 * Agent management reports the transaction's decision. An accepted disable commits the status and its audit rows and only then reports
 * success; a refused one keeps the confirm dialog open with its reason, writes no audit row, and reports no success.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { GlobalModals } from '../../shell/shell'
import { go, selectProject } from '../../router/navigate'
import { useToastStore } from '../../state/stores'
import { routes } from '../../screens/d'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const toastTexts = () => useToastStore.getState().toasts.map((t) => t.text)

/** Opens the disable dialog for AG-007, the agent the operations fixture uses. */
async function openDisableDialog(h: ReturnType<typeof mountServices>) {
  h.run(() => { selectProject('RT-2026-014'); go('agent', { id: 'AG-007' }) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Disable Agent' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Disable Agent' }))
  fireEvent.change(screen.getByLabelText(/Reason for disabling/), { target: { value: 'Host maintenance window' } })
}

describe('agent disable reports the transaction decision', () => {
  it('an accepted disable commits the status and its audit rows, then reports it', async () => {
    const h = mountServices(null, 'Dana Whitfield')
    h.show(<><GlobalModals /><routes.agent /></>)
    await openDisableDialog(h)
    fireEvent.click(screen.getByRole('button', { name: 'Disable agent' }))
    await waitFor(() => expect(h.db().agents.find((a) => a.id === 'AG-007')!.status).toBe('disabled'))
    expect(h.db().audit.find((r) => r.action === 'Reason for disabling agent' && r.obj === 'AG-007')).toMatchObject({ reason: 'Host maintenance window' })
    await waitFor(() => expect(toastTexts()).toContain('AG-007 disabled.'))
    h.unmount()
  })

  it('a refused disable keeps the dialog open with the reason, writes no audit row and reports no success', async () => {
    const h = mountServices(null, 'Dana Whitfield')
    h.show(<><GlobalModals /><routes.agent /></>)
    await openDisableDialog(h)
    const auditBefore = h.db().audit.length
    // The agent is removed while the dialog is open: the transaction refuses it as not found.
    h.run(() => h.svc().authority.commit('fixture', (d) => { d.agents = d.agents.filter((a) => a.id !== 'AG-007') }))
    fireEvent.click(screen.getByRole('button', { name: 'Disable agent' }))
    await waitFor(() => expect(screen.getByText(/AG-007 no longer exists/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Disable agent' })).toBeInTheDocument()
    expect(h.db().audit.length).toBe(auditBefore)
    expect(h.db().audit.some((r) => r.action === 'Reason for disabling agent')).toBe(false)
    expect(toastTexts()).not.toContain('AG-007 disabled.')
    h.unmount()
  })
})
