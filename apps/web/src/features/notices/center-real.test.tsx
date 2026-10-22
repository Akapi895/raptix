/**
 * The header notification center in real mode: the bell lists the server's
 * notices through the notice center port, marks one read, and dismisses another
 * only after confirmation. A notice that names no route cannot be opened.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

vi.mock('../../state/mode', () => ({ DATA_MODE: 'real', isRealMode: () => true, resolveDataMode: () => 'real' }))
vi.mock('../../state/console', () => ({ useMe: () => ({ name: 'Riley Brooks', email: 'riley@example.test', role: 'manager' }) }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'all' }),
}))
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    fetchNotices: vi.fn(),
    markNoticeRead: vi.fn(),
    dismissNotice: vi.fn(),
    markAllNoticesRead: vi.fn(),
  }
})

const api_notices = await import('./api');
const { RealFeatureServicesCtx } = await import('../../state/real-services-provider')
const { createRealFeatureServices } = await import('../../state/real-services')
const { useToastStore, useUiStore } = await import('../../state/stores')
const { HeaderNotices } = await import('./header-notices')
const { useSessionStore } = await import('../../state/session')
const { GlobalModals } = await import('../../shell/shell')

const CAPABILITIES = { version: 1, mode: 'multi-user', capabilities: { projects: { supported: true, available: true } } } as never
const NOTICES = {
  source: 'db',
  unread: 2,
  notices: [
    { id: 'n-1', engagementId: 'eng-1', kind: 'approval', title: 'Scope revision needs review', detail: null, readAt: null, dismissedAt: null, createdAt: '2026-10-17T09:00:00.000Z' },
    { id: 'n-2', engagementId: null, kind: 'system', title: 'Runtime restarted', detail: null, readAt: null, dismissedAt: null, createdAt: '2026-10-17T08:00:00.000Z' },
  ],
}

function renderHeader(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services = createRealFeatureServices(CAPABILITIES)
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <RealFeatureServicesCtx.Provider value={services}>{children}</RealFeatureServicesCtx.Provider>
    </QueryClientProvider>
  )
  render(<><HeaderNotices /><GlobalModals /></>, { wrapper })
}

beforeEach(() => {
  vi.mocked(api_notices.fetchNotices).mockReset().mockResolvedValue(NOTICES as never)
  vi.mocked(api_notices.markNoticeRead).mockReset().mockResolvedValue({ ...NOTICES.notices[0], readAt: '2026-10-17T10:00:00.000Z' } as never)
  vi.mocked(api_notices.dismissNotice).mockReset().mockResolvedValue({ ...NOTICES.notices[1], dismissedAt: '2026-10-17T10:00:00.000Z' } as never)
  vi.mocked(api_notices.markAllNoticesRead).mockReset().mockResolvedValue({ updated: 2 })
  useSessionStore.setState({ confirmation: null } as never)
  useToastStore.setState({ toasts: [] } as never)
  useUiStore.setState({ noticesOpen: false } as never)
})

afterEach(() => {
  cleanup()
})

describe('HeaderNotices in real mode (notice center port)', () => {
  it('lists the server notices with their project, and shows the unread count on the bell', async () => {
    renderHeader()
    fireEvent.click(await screen.findByTestId('notice-bell'))
    expect(await screen.findByTestId('notice-row-n-1')).toHaveTextContent('Scope revision needs review')
    expect(screen.getByTestId('notice-row-n-1')).toHaveTextContent('eng-1')
    expect(screen.getByTestId('notice-row-n-2')).toHaveTextContent('System')
    expect(screen.getByTestId('notice-badge')).toHaveTextContent('2')
  })

  it('marks a notice read through the port and refreshes the list', async () => {
    renderHeader()
    fireEvent.click(await screen.findByTestId('notice-bell'))
    await screen.findByTestId('notice-row-n-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Mark n-1 as read' }))
    await waitFor(() => expect(api_notices.markNoticeRead).toHaveBeenCalledWith('n-1'))
  })

  it('offers no Open action for a notice that names no route, and dismisses only after confirmation', async () => {
    renderHeader()
    fireEvent.click(await screen.findByTestId('notice-bell'))
    const row = await screen.findByTestId('notice-row-n-1')
    expect(row.querySelector('button[disabled]')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss n-2' }))
    expect(api_notices.dismissNotice).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(api_notices.dismissNotice).toHaveBeenCalledWith('n-2'))
  })
})
