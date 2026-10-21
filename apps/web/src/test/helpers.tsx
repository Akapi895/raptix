import { act, render } from '@testing-library/react'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { ConsoleProviders } from '../state/query'
import { ServicesProvider, useServices } from '../state/services'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ConsoleServices } from '../domain/console-services';
import { useAuthStore } from '../state/stores'

// eslint-disable-next-line react-refresh/only-export-components -- test-only provider capture
function ServicesProbe({ ready }: { ready: (services: ConsoleServices, client: QueryClient) => void }): null {
  ready(useServices(), useQueryClient())
  return null
}

/** Mounts the actual service lifecycle and Query subscriptions, with optional rendered UI. `wire` runs once when the services are first captured, before any child effect. */
export function mountServices(ui: ComponentType | ReactNode = null, me = 'Alex Morgan', wire?: (services: ConsoleServices) => void) {
  let services!: ConsoleServices
  let client!: QueryClient
  const wired = new WeakSet<ConsoleServices>()
  const tree = (children: ReactNode) => (
    <ServicesProvider>
      <ConsoleProviders>
        <ServicesProbe ready={(s, c) => {
          services = s; client = c
          if (wire && !wired.has(s)) { wired.add(s); wire(s) }
        }} />
        {children}
      </ConsoleProviders>
    </ServicesProvider>
  )
  const view = render(tree(typeof ui === 'function' ? createElement(ui) : ui))
  act(() => { useAuthStore.getState().setMe(me) })
  return Object.assign(view, {
    svc: (): ConsoleServices => services,
    qc: (): QueryClient => client,
    db: () => services.authority.snapshot(),
    as: (name: string): void => { act(() => { useAuthStore.getState().setMe(name) }) },
    run: <T,>(fn: () => T): T => { let out!: T; act(() => { out = fn() }); return out },
    show: (children: ReactNode): void => { view.rerender(tree(children)) },
  })
}
