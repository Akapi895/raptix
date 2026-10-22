/**
 * Operation controls report the handler's decision. An accepted pause or stop commits and only then reports success; a refused one
 * keeps the confirm dialog open with the handler's reason, commits nothing, and shows no success toast.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { GlobalModals } from '../../shell/shell'
import { selectProject } from '../../router/navigate'
import { useToastStore } from '../../state/stores'
import type { ActorRef, RequestContext } from '../../domain/service'
import type { Operation } from '../../domain/entities'
import { createOperationDraft, runOperationPreflight, startOperation, type OperationDraftInput } from './service'
import { OpControls } from './views/operation-console'
import { assignAgentTransaction } from '../agents/writes'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

let corrSeq = 0
const ctxOf = (a: ActorRef, projectId: string): RequestContext => ({ actor: a, projectId, corr: `ctl-${++corrSeq}` })
const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const TAYLOR: ActorRef = { id: 'Taylor Chen', role: 'operator' }
const P14 = 'RT-2026-014'

const draftInput = (over: Partial<OperationDraftInput> = {}): OperationDraftInput => ({
  name: 'Control probe', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001',
  agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual with confirmation', needConfirm: true,
  note: '', schedule: 'now', ...over,
})

/** Mounts a running operation in the selected project; the controls are then rendered by the test. */
function runningOperation(h: ReturnType<typeof mountServices>): string {
  const svc = h.svc()
  let opId = ''
  h.run(() => {
    selectProject(P14)
    const assigned = assignAgentTransaction(svc.authority, svc.clock, ctxOf(ALEX, P14), 'AG-012', { projectId: P14 })
    if (!assigned.ok) throw new Error(assigned.failure.message)
    const created = createOperationDraft(svc.authority, svc.clock, ctxOf(TAYLOR, P14), draftInput())
    if (!created.ok) throw new Error(created.failure.message)
    opId = created.data.op.id
    const pf = runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId)
    if (!pf.ok || !pf.data.pass) throw new Error('fixture preflight did not pass')
    const started = startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId)
    if (!started.ok) throw new Error(started.failure.message)
  })
  return opId
}

const operationOf = (h: ReturnType<typeof mountServices>, opId: string): Operation => h.db().operations.find((o) => o.id === opId)!
const toastTexts = () => useToastStore.getState().toasts.map((t) => t.text)

describe('operation pause and stop report the handler decision', () => {
  it('an accepted pause commits the pause and only then reports it', async () => {
    const h = mountServices(null, 'Taylor Chen')
    const opId = runningOperation(h)
    h.show(<><GlobalModals /><OpControls op={operationOf(h, opId)} onError={() => {}} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.change(screen.getByLabelText(/Reason for pausing/), { target: { value: 'Step 2 needs a decision' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pause operation' }))
    await waitFor(() => expect(operationOf(h, opId).status).toBe('paused'))
    await waitFor(() => expect(toastTexts()).toContain('Operation paused.'))
    h.unmount()
  })

  it('a refused pause keeps the dialog open with the handler reason, commits nothing and reports no success', async () => {
    const h = mountServices(null, 'Taylor Chen')
    const opId = runningOperation(h)
    h.show(<><GlobalModals /><OpControls op={operationOf(h, opId)} onError={() => {}} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.change(screen.getByLabelText(/Reason for pausing/), { target: { value: 'Step 2 needs a decision' } })
    // The operation finishes while the dialog is open: the handler re-derives the gate and refuses.
    h.run(() => h.svc().authority.commit('fixture', (d) => { d.operations.find((o) => o.id === opId)!.status = 'done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause operation' }))
    await waitFor(() => expect(screen.getByText(/only a running operation can be paused/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Pause operation' })).toBeInTheDocument()
    expect(operationOf(h, opId).status).toBe('done')
    expect(toastTexts()).not.toContain('Operation paused.')
    h.unmount()
  })

  it('a refused stop keeps the dialog open with the handler reason and never reports the operation stopped', async () => {
    const h = mountServices(null, 'Taylor Chen')
    const opId = runningOperation(h)
    h.show(<><GlobalModals /><OpControls op={operationOf(h, opId)} onError={() => {}} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.change(screen.getByLabelText(/Reason for stopping/), { target: { value: 'Scope changed mid-run' } })
    h.run(() => h.svc().authority.commit('fixture', (d) => { d.operations.find((o) => o.id === opId)!.status = 'done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop operation' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop operation' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/running or paused/)).toBeInTheDocument())
    expect(toastTexts()).not.toContain('Stop requested. Stopping…')
    expect(toastTexts()).not.toContain('Operation stopped.')
    expect(operationOf(h, opId).status).toBe('done')
    h.unmount()
  })
})
