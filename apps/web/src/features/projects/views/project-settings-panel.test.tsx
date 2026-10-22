/**
 * W22: the project detail Settings tab edits the display name and target
 * through the real PATCH contract — a refused save keeps the form and
 * surfaces the reason instead of silently claiming success. The operator
 * brief is not PATCH-editable and must never be sent (the server rejects it).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts';

// The first import loads the module graph; keep that cold start out of the test timer.
beforeAll(async () => {
  await import('./project-settings-panel')
}, 30_000)

const patchEngagement = vi.fn()

vi.mock('../remote', () => ({
  patchEngagement: (...a: unknown[]) => patchEngagement(...a),
}))

function project(): ProjectViewModel {
  return {
    id: 'proj-1',
    name: 'proj-1',
    displayName: 'Acme staging',
    targetType: 'web',
    targetValue: 'https://staging.acme.test',
    status: 'active',
    authorizationConfirmed: true,
    workspaceSlug: 'acme-staging',
    brief: 'Original brief.',
  } as unknown as ProjectViewModel
}

async function renderSettings(p: ProjectViewModel): Promise<void> {
  const { ProjectSettingsPanel } = await import('./project-settings-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<ProjectSettingsPanel project={p} />, { wrapper })
}

beforeEach(() => {
  patchEngagement.mockReset().mockImplementation(async (_id: string, input: { displayName?: string; targetValue?: string }) => ({
    ...project(),
    ...(input ?? {}),
  }))
})

afterEach(() => {
  cleanup()
})

describe('ProjectSettingsPanel (W22 project edit)', () => {
  it('saves display name and target through the engagement PATCH without the non-patchable brief', async () => {
    await renderSettings(project())
    const target = await screen.findByLabelText(/primary target/i)
    await userEvent.clear(target)
    await userEvent.type(target, 'https://prod.acme.test')
    const name = screen.getByLabelText(/display name/i)
    await userEvent.clear(name)
    await userEvent.type(name, 'Acme staging (v2)')
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }))
    await waitFor(() => expect(patchEngagement).toHaveBeenCalledWith('proj-1', { displayName: 'Acme staging (v2)', targetValue: 'https://prod.acme.test' }))
    const payload = patchEngagement.mock.calls[0]![1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('brief')
    expect(screen.queryByLabelText(/operator brief/i)).toBeNull()
  })

  it('keeps the form and surfaces the server reason when the patch is refused', async () => {
    patchEngagement.mockRejectedValue(new Error('The target is locked after the runtime context was frozen.'))
    await renderSettings(project())
    const target = await screen.findByLabelText(/primary target/i)
    await userEvent.clear(target)
    await userEvent.type(target, 'https://other.acme.test')
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }))
    expect(await screen.findByText(/locked after the runtime context/i)).toBeInTheDocument()
    expect((screen.getByLabelText(/primary target/i) as HTMLInputElement).value).toBe('https://other.acme.test')
  })
})
