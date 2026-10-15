/**
 * Real-mode composition root (integration ticket 03, ADR-0068).
 *
 * Bootstraps the trusted server document (capabilities + deployment mode)
 * BEFORE any data read happens, then exposes the transport + identity to the
 * app through context. The mock authority, demo timers and seed data are
 * never created in this mode (R02): a bootstrap failure renders an
 * actionable error with an explicit opt-in switch back to demo mode — it
 * never falls back automatically.
 */
import { useQuery, QueryClientProvider } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, type ReactElement, type ReactNode } from 'react'
import { Loader2, PlugZap, RefreshCw, ServerCrash } from 'lucide-react'
import { capabilityState, fetchCapabilities, type CapabilitiesDocument } from './api'
import { switchDataMode } from './mode'
import { REAL_IDENTITY, type RealIdentity } from './identity'
import { createConsoleQueryClient } from '../state/keys'
import { Button } from '../ui'
import { RealLoginGate } from './screens/login'

export { REAL_IDENTITY, REAL_PERSONA, type RealIdentity } from './identity'

interface RealContextValue {
  readonly document: CapabilitiesDocument
  readonly identity: RealIdentity
}

const RealContext = createContext<RealContextValue | null>(null)

/** Real-mode services; throws outside the real composition (fail-fast). */
// eslint-disable-next-line react-refresh/only-export-components
export function useReal(): RealContextValue {
  const ctx = useContext(RealContext)
  if (!ctx) throw new Error('Real-mode context is not mounted (this surface cannot read real data).')
  return ctx
}

function useCapabilitiesQuery() {
  return useQuery({
    queryKey: ['real', 'bootstrap', REAL_IDENTITY.id],
    queryFn: () => fetchCapabilities(),
    staleTime: 30_000,
  })
}

function BootError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-fg" role="alert">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-panel text-bad"><ServerCrash size={26} aria-hidden /></div>
        <h1 className="text-xl font-semibold tracking-tight">Cannot reach the Raptix API</h1>
        <p className="mt-2 break-words text-sm text-muted">{message}</p>
        <p className="mt-1 text-xs text-neutral">Real mode shows no demo data. Start the API (npm run dev:api) or switch to demo mode.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="primary" icon={RefreshCw} onClick={onRetry}>Retry</Button>
          <Button variant="secondary" icon={PlugZap} onClick={() => switchDataMode('mock')}>Switch to demo mode</Button>
        </div>
      </div>
    </div>
  )
}

function BootLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Connecting to the Raptix API">
      <div className="flex flex-col items-center gap-3 text-muted">
        <Loader2 size={24} className="animate-spin text-cyan" aria-hidden />
        <span className="text-sm">Connecting to the Raptix API…</span>
      </div>
    </div>
  )
}

/** Wraps the router with the real-mode Query client and trusted document. */
export function RealModeProvider({ children }: { children: ReactNode }): ReactElement {
  const client = useMemo(() => createConsoleQueryClient(), [])
  useEffect(() => () => client.clear(), [client])
  return (
    <QueryClientProvider client={client}>
      <RealBoot>{children}</RealBoot>
    </QueryClientProvider>
  )
}

function RealBoot({ children }: { children: ReactNode }): ReactElement {
  const boot = useCapabilitiesQuery()
  if (boot.isPending) return <BootLoading />
  if (boot.isError || !boot.data) {
    return <BootError message={boot.error instanceof Error ? boot.error.message : 'The bootstrap request failed.'} onRetry={() => void boot.refetch()} />
  }
  return <RealContext.Provider value={{ document: boot.data, identity: REAL_IDENTITY }}><RealLoginGate>{children}</RealLoginGate></RealContext.Provider>
}

/** Whether a capability is usable right now (supported AND available). */
// eslint-disable-next-line react-refresh/only-export-components
export function useCapabilityReady(name: string): { ready: boolean; reason: string | null } {
  const { document } = useReal()
  const capability = capabilityState(document, name)
  if (!capability || !capability.supported) return { ready: false, reason: 'This capability is not implemented on the connected server.' }
  if (!capability.available) {
    return { ready: false, reason: capability.reason ? `Unavailable: ${capability.reason.replace(/_/g, ' ')}.` : 'This capability is currently unavailable on the server.' }
  }
  return { ready: true, reason: null }
}
