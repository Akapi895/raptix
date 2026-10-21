/**
 * Vault query binding (plan P09, Vault slice). The list is metadata only and
 * keyed by the auth scope; reveal, store and revoke go through VaultService and
 * refresh the list. A revealed value is held only by the screen, for this
 * session, until it is hidden or the secret is revoked.
 */
import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure } from '../../domain/service'
import type { VaultRead, VaultRevealed, VaultSecretMeta } from './service'

export class VaultError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'VaultError'
  }
}

/** The engagement the tab is bound to; the caller names it, so the read never depends on the selected project. */
const ctxOf = (scope: QueryScope, projectId: string, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId, corr })

export function useVaultRead(projectId: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('vault', scope, projectId, 'list'),
    queryFn: async (): Promise<VaultRead> => {
      const res = await services.vault(actorRef(scope.actor, scope.role), projectId).list(ctxOf(scope, projectId, 'vault-list'))
      if (!res.ok) throw new VaultError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

export function useVaultWrites(projectId: string) {
  const services = useServices()
  const scope = useQueryScope()
  const client = useQueryClient()
  return useMemo(() => {
    const svc = () => services.vault(actorRef(scope.actor, scope.role), projectId)
    const refresh = async (): Promise<void> => {
      await client.invalidateQueries({ queryKey: ['vault'] })
    }
    return {
      reveal: async (secretId: string): Promise<VaultRevealed> => {
        const res = await svc().reveal(ctxOf(scope, projectId, 'vault-reveal'), secretId)
        if (!res.ok) throw new VaultError(res.failure)
        await refresh()
        return res.data
      },
      store: async (input: { kind: string; label: string; plaintext: string }): Promise<VaultSecretMeta> => {
        const res = await svc().store(ctxOf(scope, projectId, 'vault-store'), input)
        if (!res.ok) throw new VaultError(res.failure)
        await refresh()
        return res.data
      },
      revoke: async (secretId: string): Promise<void> => {
        const res = await svc().revoke(ctxOf(scope, projectId, 'vault-revoke'), secretId)
        if (!res.ok) throw new VaultError(res.failure)
        await refresh()
      },
    }
  }, [services, scope, client, projectId])
}
