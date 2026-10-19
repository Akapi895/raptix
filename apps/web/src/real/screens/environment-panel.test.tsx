// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EnvironmentCommandResult, EnvironmentStateView } from '@raptix/web-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { ApiTransportError } from '../transport'

const fetchEnvironment = vi.fn()
const submitEnvironmentCommand = vi.fn()
const listEngagements = vi.fn()

vi.mock('../environment-api', () => ({
  fetchEnvironment: (...a: unknown[]) => fetchEnvironment(...a),
  submitEnvironmentCommand: (...a: unknown[]) => submitEnvironmentCommand(...a),
}))

vi.mock('../api', () => ({
  listEngagements: (...a: unknown[]) => listEngagements(...a),
}))

const { EnvironmentPanel } = await import('./environment-panel')

function state(engagementId: string, overrides: { observed?: EnvironmentStateView['environment']['observedState']; phase?: EnvironmentStateView['slot']['phase']; own?: boolean; version?: number } = {}): EnvironmentStateView {
  const phase = overrides.phase ?? 'idle'
  return {
    engagementId,
    environment: { observedState: overrides.observed ?? 'stopped', desiredState: 'stopped', generation: 1, observedAt: null },
    slot: { phase, version: overrides.version ?? 2, held: phase !== 'idle', ownedByThisProject: overrides.own ?? false, activeEngagementId: overrides.own ? engagementId : null },
  }
}

const project = (id: string, displayName: string) => ({ id, workspaceSlug: id, displayName, targetType: 'web_url', targetValue: 'https://lab.invalid', authorizationConfirmed: true })

function renderPanel(engagementId = 'eng-b', projectName = 'Bravo'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const element: ReactElement = (
    <QueryClientProvider client={client}>
      <EnvironmentPanel engagementId={engagementId} projectName={projectName} />
    </QueryClientProvider>
  )
  render(element)
}

beforeEach(() => {
  fetchEnvironment.mockReset()
  submitEnvironmentCommand.mockReset()
  listEngagements.mockReset()
})

afterEach(() => cleanup())

describe('EnvironmentPanel', () => {
  it('activates a stopped project with the slot version it read, and says it is starting', async () => {
    fetchEnvironment.mockResolvedValue(state('eng-b', { version: 5 }))
    submitEnvironmentCommand.mockResolvedValue({ status: 'accepted', phase: 'starting', version: 6, commandId: 'c1' } satisfies EnvironmentCommandResult)
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Activate Bravo' }))
    await waitFor(() => expect(submitEnvironmentCommand).toHaveBeenCalledTimes(1))
    expect(submitEnvironmentCommand.mock.calls[0]?.[0]).toBe('eng-b')
    expect(submitEnvironmentCommand.mock.calls[0]?.[1]).toMatchObject({ action: 'activate', expectedVersion: 5 })
    expect(await screen.findByText(/Starting the environment/)).toBeTruthy()
  })

  it('sends one command for a double click, and the same request id on a repeated intent', async () => {
    fetchEnvironment.mockResolvedValue(state('eng-b'))
    let release: (value: EnvironmentCommandResult) => void = () => undefined
    submitEnvironmentCommand.mockReturnValue(new Promise<EnvironmentCommandResult>(resolve => { release = resolve }))
    renderPanel()
    const button = await screen.findByRole('button', { name: 'Activate Bravo' })
    await userEvent.dblClick(button)
    expect(submitEnvironmentCommand).toHaveBeenCalledTimes(1)
    release({ status: 'replayed', phase: 'starting', version: 3, commandId: 'c1' })
  })

  it('offers a two-step switch when another project of the caller holds the slot, and names only that project', async () => {
    const alpha = state('eng-a', { observed: 'ready', phase: 'ready', own: true })
    const bravo = state('eng-b', { phase: 'ready', version: 4 })
    fetchEnvironment.mockImplementation(async (id: string) => (id === 'eng-a' ? alpha : bravo))
    listEngagements.mockResolvedValue([project('eng-a', 'Alpha'), project('eng-b', 'Bravo')])
    submitEnvironmentCommand.mockImplementation(async (id: string, body: { action: string }) =>
      body.action === 'stop'
        ? { status: 'accepted', phase: 'stopping', version: 3, commandId: 'stop-1' }
        : { status: 'accepted', phase: 'starting', version: 5, commandId: 'start-1' })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Switch from another project' }))
    const confirm = await screen.findByRole('button', { name: 'Stop Alpha and switch to Bravo' })
    expect(screen.queryByText(/eng-a/)).toBeNull()
    await userEvent.click(confirm)
    await waitFor(() => expect(submitEnvironmentCommand).toHaveBeenCalledTimes(2))
    expect(submitEnvironmentCommand.mock.calls[0]?.[0]).toBe('eng-a')
    expect(submitEnvironmentCommand.mock.calls[0]?.[1]).toMatchObject({ action: 'stop', expectedVersion: 2 })
    expect(submitEnvironmentCommand.mock.calls[1]?.[0]).toBe('eng-b')
    expect(submitEnvironmentCommand.mock.calls[1]?.[1]).toMatchObject({ action: 'activate' })
  })

  it('names no holder it cannot see, and starts nothing', async () => {
    // The slot is held, but not by this caller. The other project is one this caller cannot read.
    fetchEnvironment.mockImplementation(async (id: string) => {
      if (id === 'eng-a') throw new ApiTransportError(404, 'not_found', 'The requested record does not exist or is out of scope.')
      return state(id, { phase: 'ready' })
    })
    listEngagements.mockResolvedValue([project('eng-a', 'Alpha'), project('eng-b', 'Bravo')])
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Switch from another project' }))
    expect(await screen.findByText(/you cannot see it/)).toBeTruthy()
    expect(screen.queryByText(/Alpha/)).toBeNull()
    expect(submitEnvironmentCommand).not.toHaveBeenCalled()
  })

  it('shows the busy answer as a next step and does not switch by itself', async () => {
    fetchEnvironment.mockResolvedValue(state('eng-b'))
    submitEnvironmentCommand.mockResolvedValue({ status: 'busy', phase: 'ready', version: 2, commandId: null } satisfies EnvironmentCommandResult)
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Activate Bravo' }))
    expect(await screen.findByText(/Another project is running on this deployment/)).toBeTruthy()
    expect(submitEnvironmentCommand).toHaveBeenCalledTimes(1)
  })

  it('refreshes after a stale answer so the operator retries against the current version', async () => {
    fetchEnvironment.mockResolvedValueOnce(state('eng-b', { version: 2 })).mockResolvedValue(state('eng-b', { version: 4 }))
    submitEnvironmentCommand.mockResolvedValue({ status: 'stale', phase: 'idle', version: 4, commandId: null, reason: 'stale_version' } satisfies EnvironmentCommandResult)
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Activate Bravo' }))
    expect(await screen.findByText(/changed while you were looking at it/)).toBeTruthy()
    await waitFor(() => expect(fetchEnvironment.mock.calls.length).toBeGreaterThan(1))
  })

  it('recovers after a reload in a moving state, and sends nothing on its own', async () => {
    fetchEnvironment.mockResolvedValue(state('eng-b', { observed: 'starting', phase: 'starting', own: true }))
    renderPanel()
    expect(await screen.findByText(/Starting the project environment/)).toBeTruthy()
    expect(submitEnvironmentCommand).not.toHaveBeenCalled()
  })

  it('asks the owner to reconcile an uncertain environment by stopping it, with the current version', async () => {
    fetchEnvironment.mockResolvedValue(state('eng-b', { observed: 'uncertain', phase: 'uncertain', own: true, version: 7 }))
    submitEnvironmentCommand.mockResolvedValue({ status: 'accepted', phase: 'stopping', version: 8, commandId: 's1' } satisfies EnvironmentCommandResult)
    renderPanel()
    expect(await screen.findByText(/The outcome of the last change is not known/)).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: 'Stop to reconcile' }))
    await waitFor(() => expect(submitEnvironmentCommand).toHaveBeenCalledTimes(1))
    expect(submitEnvironmentCommand.mock.calls[0]?.[1]).toMatchObject({ action: 'stop', expectedVersion: 7 })
  })

  it('explains a refusal for a viewer and offers no change', async () => {
    fetchEnvironment.mockResolvedValue(state('eng-b'))
    submitEnvironmentCommand.mockRejectedValue(new ApiTransportError(404, 'not_found', 'The requested record does not exist or is out of scope.'))
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Activate Bravo' }))
    expect(await screen.findByText(/you cannot change it/)).toBeTruthy()
  })

  it('says the controller is not available instead of a generic failure', async () => {
    fetchEnvironment.mockResolvedValue(state('eng-b'))
    submitEnvironmentCommand.mockRejectedValue(new ApiTransportError(503, 'unavailable', 'The requested capability is unavailable on the server.'))
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Activate Bravo' }))
    expect(await screen.findByText(/controller is not configured or reachable/)).toBeTruthy()
  })
})
