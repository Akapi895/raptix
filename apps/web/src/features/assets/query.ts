/**
 * Asset inventory Query binding (ticket 50, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders: keys
 * start with the `asset` entity kind and embed the auth scope at position 1,
 * so any committed asset change invalidates the `[kind]` prefix (a legacy
 * asset change updates these views without a reload) and a persona/project
 * switch cancels the superseded scope's reads before a delayed response can
 * restore old visibility.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useFeatureServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { AssetDetailRead, AssetListQuery, AssetListRead, AssetObservedGraph, AssetScopeRead, AssetService } from './service'

/** Feature-local key namespaces: ['asset', scope, 'list', query] / ['asset', scope, id] / ['asset', scope, 'scope']. */
export const assetKeys = {
  list: (scope: QueryScope, query: AssetListQuery) => consoleKeys.view('asset', scope, 'list', query),
  detail: (scope: QueryScope, id: string) => consoleKeys.entity('asset', scope, id),
  scope: (scope: QueryScope) => consoleKeys.view('asset', scope, 'scope'),
  graph: (scope: QueryScope) => consoleKeys.view('asset', scope, 'graph'),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class AssetReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'AssetReadError'
  }
}

/** The asset port for the current auth/project scope; writes take it as their dependency. */
export function useAssetPort(): AssetService {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useMemo(() => services.assets(actorRef(scope.actor, scope.role), scope.project), [services, scope.actor, scope.role, scope.project])
}

/** Query-backed asset catalog for the current auth/project scope. */
export function useAssetList(query: AssetListQuery) {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: assetKeys.list(scope, query),
    queryFn: async (): Promise<AssetListRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .assets(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'assets-list' }, query)
      if (!res.ok) throw new AssetReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed asset detail (scoped relationships, masking, history). */
export function useAssetDetail(id?: string) {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: assetKeys.detail(scope, id || ''),
    queryFn: async (): Promise<AssetDetailRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .assets(actor, scope.project)
        .get({ actor, projectId: scope.project, corr: 'asset-detail' }, id || '')
      if (!res.ok) throw new AssetReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

/** Query-backed observed attack-chain graph (real mode). */
export function useObservedGraph() {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: assetKeys.graph(scope),
    queryFn: async (): Promise<AssetObservedGraph> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services.assets(actor, scope.project).observedGraph({ actor, projectId: scope.project, corr: 'asset-graph' })
      if (!res.ok) throw new AssetReadError(res.failure)
      return res.data
    },
    enabled: !!services,
    retry: false,
  })
}

/** Query-backed scope-classification view (scoped rows + per-project contexts). */
export function useAssetScope() {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: assetKeys.scope(scope),
    queryFn: async (): Promise<AssetScopeRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .assets(actor, scope.project)
        .scope({ actor, projectId: scope.project, corr: 'assets-scope' })
      if (!res.ok) throw new AssetReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}
