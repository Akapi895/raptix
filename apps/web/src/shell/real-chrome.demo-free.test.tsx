/**
 * Real-mode shell and Settings carry no demo facts (quick win UX-01). The real
 * top bar is the only header mounted in real mode, and the shared Settings page
 * must not name the demo organization, the simulation or demo project IDs.
 * Only the mode flags are replaced; the rest of the mode module stays real.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

vi.mock('../state/mode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/mode')>()),
  DATA_MODE: 'real',
  isRealMode: () => true,
}))

const { RealTopbar } = await import('./real-chrome')
const { SettingsPage } = await import('../features/settings/views/settings-page')
const { RealContext } = await import('../state/real-context')
const { REAL_IDENTITY } = await import('../state/real-identity')
const { RealFeatureServicesCtx } = await import('../state/real-services-provider')
const { createRealFeatureServices } = await import('../state/real-services')

const CAPABILITIES = { version: 1, mode: 'multi-user', capabilities: { projects: { supported: true, available: true } } } as never

function renderReal(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services = createRealFeatureServices(CAPABILITIES)
  return render(
    <QueryClientProvider client={client}>
      <RealContext.Provider value={{ document: CAPABILITIES, identity: REAL_IDENTITY }}>
        <RealFeatureServicesCtx.Provider value={services}>{ui}</RealFeatureServicesCtx.Provider>
      </RealContext.Provider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('real-mode shell', () => {
  it('mounts the real top bar without demo workspace or demo tools', () => {
    renderReal(<RealTopbar openMobile={() => {}} />)
    expect(screen.getByText('Real mode')).toBeInTheDocument()
    expect(screen.queryByText('Raptix Workspace — Test Lab')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.queryByLabelText('Demo Tools')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Reset demo/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Prototype Home/ })).toBeNull()
  })

  it('shows no demo organization, simulation copy or demo project IDs on Settings', () => {
    renderReal(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Organization Settings' })).toBeInTheDocument()
    expect(screen.queryByText(/Acme Security \(Demo\)/)).toBeNull()
    expect(screen.queryByText(/This is a simulation/)).toBeNull()
    expect(screen.queryByText(/RT-2026-014/)).toBeNull()
    expect(screen.queryByText(/RT-2026-017/)).toBeNull()
  })
})
