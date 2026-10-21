/** Role overrides must change both cache identity and handler authorization. */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ServicesProvider, useServices } from '../state/services'
import { ConsoleProviders } from '../state/query'
import { useQueryScope, type QueryScope } from '../state/keys'
import type { ConsoleServices } from '../domain/console-services';
import { useAssetList } from '../features/assets/query'
import { useAuthStore } from '../state/stores'

afterEach(cleanup)

it('removes elevated visibility when the organization overrides the persona to operator', async () => {
  let services!: ConsoleServices
  let scope!: QueryScope
  let projects: string[] = []
  function Probe() {
    services = useServices()
    scope = useQueryScope()
    const assets = useAssetList({})
    projects = assets.data?.items.map((a) => a.asset.projectId) ?? []
    return null
  }
  render(<ServicesProvider><ConsoleProviders><Probe /></ConsoleProviders></ServicesProvider>)
  act(() => useAuthStore.getState().setMe('Jordan Lee'))
  await waitFor(() => expect(projects.length).toBeGreaterThan(0))
  expect(projects).toContain('RT-2026-014')
  act(() => services.authority.commit('role-override', (db) => {
    db.org.members['Jordan Lee'] = { ...db.org.members['Jordan Lee'], role: 'operator' }
  }))
  await waitFor(() => expect(scope.role).toBe('operator'))
  await waitFor(() => expect(projects).not.toContain('RT-2026-014'))
})
