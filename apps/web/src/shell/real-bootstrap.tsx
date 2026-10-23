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
import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react'
import { Loader2, PlugZap, RefreshCw, ServerCrash } from 'lucide-react'
import { fetchCapabilities } from '../platform/capabilities';
import { switchDataMode } from '../state/mode'
import { REAL_IDENTITY } from '../state/real-identity'
import { RealContext } from '../state/real-context'
import { createConsoleQueryClient } from '../state/keys'
import { Button } from '../ui'
import { RealLoginGate } from './real-login'
import { RealFeatureServicesProvider } from '../state/real-services-provider'

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
        <h1 className="text-xl font-semibold tracking-tight">Raptix is unavailable right now</h1>
        <p className="mt-2 break-words text-sm text-muted">{message}</p>
        {/* Developer hints and the demo escape hatch exist only in the dev server; a deployed build shows the user message. */}
        <p className="mt-1 text-xs text-neutral">
          {import.meta.env.DEV
            ? 'Real mode shows no demo data. Start the API (npm run dev:api) or switch to demo mode.'
            : 'Real mode shows no demo data. Retry, or contact your administrator if this continues.'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="primary" icon={RefreshCw} onClick={onRetry}>Retry</Button>
          {import.meta.env.DEV && <Button variant="secondary" icon={PlugZap} onClick={() => switchDataMode('mock')}>Switch to demo mode</Button>}
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
  return <RealContext.Provider value={{ document: boot.data, identity: REAL_IDENTITY }}><RealFeatureServicesProvider document={boot.data}><RealLoginGate deploymentId={boot.data.deploymentId}>{children}</RealLoginGate></RealFeatureServicesProvider></RealContext.Provider>
}
