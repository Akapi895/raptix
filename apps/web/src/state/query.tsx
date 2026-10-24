/**
 * Console Query provider (ticket 05, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * ConsoleProviders wraps the app in one QueryClient. Entries are keyed by the
 * auth scope (actor, role, project) and the cache is cleared on unmount, so a
 * remount starts from an empty cache.
 */
import { useEffect, useMemo, type ReactNode } from 'react'
import { notifyManager, QueryClientProvider } from '@tanstack/react-query'
import { createConsoleQueryClient } from './keys'

// Observer delivery runs on the microtask queue, so a state change renders in the same tick.
notifyManager.setScheduler(queueMicrotask)

export function ConsoleProviders({ children }: { children: ReactNode }) {
  const client = useMemo(() => createConsoleQueryClient(), [])
  useEffect(() => () => client.clear(), [client])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
