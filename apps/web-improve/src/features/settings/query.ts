/**
 * Organization settings Query binding (ticket 56, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `org` entity kind and embed the auth scope at position 1:
 * any committed org change (this service's writes) invalidates the `['org']`
 * prefix, and the bridge's project-view invalidation also reaches these views
 * when a legacy action changes a project the members view derives from (a
 * wizard-created membership appears in the users table without a reload).
 * A persona/project switch cancels the superseded scope's reads.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useServices, useStore } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Integration, OrgInvite, OrgProfile, Policy, Role } from '../../domain/entities'
import type {
  IntegrationAction, IntegrationsRead, OrgInviteInput, OrgMemberStatusAction, OrgMemberView,
  OrgProfilePatch, OrgProfileRead, OrgMembersRead, PoliciesRead,
  AuditQuery, AuditRead, RetentionPatch, RetentionRead,
} from './service'
import type { Retention } from '../../domain/entities'

/** Feature-local key namespaces: ['org', scope, 'profile' | 'members']. */
export const orgKeys = {
  profile: (scope: QueryScope) => consoleKeys.view('org', scope, 'profile'),
  members: (scope: QueryScope) => consoleKeys.view('org', scope, 'members'),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class OrgReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'OrgReadError'
  }
}

/**
 * The actor for org reads/writes comes from the store's persona projection,
 * which applies committed role overrides — a member whose role was changed in
 * settings is authorized under the new role immediately (no fork between the
 * legacy seam and this typed one). Query keys stay scoped by persona/project.
 */
function useOrgActor() {
  const { me } = useStore()
  return useMemo(() => ({ id: me.name, role: me.role }), [me.name, me.role])
}

/** Query-backed organization profile for the current auth/project scope. */
export function useOrgProfile() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useQuery({
    queryKey: orgKeys.profile(scope),
    queryFn: async (): Promise<OrgProfileRead> => {
      const res = await services
        .settings(actor, scope.project)
        .getProfile({ actor, projectId: scope.project, corr: 'org-profile' })
      if (!res.ok) throw new OrgReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed organization members (roles, statuses, invites, project ids). */
export function useOrgMembers() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useQuery({
    queryKey: orgKeys.members(scope),
    queryFn: async (): Promise<OrgMembersRead> => {
      const res = await services
        .settings(actor, scope.project)
        .getMembers({ actor, projectId: scope.project, corr: 'org-members' })
      if (!res.ok) throw new OrgReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Write-side binding (ticket 56): typed organization mutations for the
 * current scope. Each call captures actor/project at call time — a persona
 * or project switch never retargets an in-flight write — and every commit
 * publishes one ChangeSet the bridge turns into refetches for both the
 * Query views and the legacy store. Callers resolve the explicit
 * ServiceResult: a refused write never commits, and the message is safe to
 * render.
 */
export function useOrgWrites() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useMemo(() => {
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    const svc = () => services.settings(actor, scope.project)
    return {
      updateProfile: (patch: OrgProfilePatch): Promise<ServiceResult<OrgProfile>> =>
        svc().updateProfile(ctx('org-profile-save'), patch),
      setMemberRole: (name: string, role: Role, reason: string): Promise<ServiceResult<OrgMemberView>> =>
        svc().setMemberRole(ctx('org-member-role'), name, role, reason),
      setMemberStatus: (name: string, action: OrgMemberStatusAction, reason: string): Promise<ServiceResult<OrgMemberView>> =>
        svc().setMemberStatus(ctx('org-member-status'), name, action, reason),
      inviteMember: (input: OrgInviteInput): Promise<ServiceResult<OrgInvite>> =>
        svc().inviteMember(ctx('org-invite'), input),
    }
  }, [services, scope.project, actor])
}

/* ───────────── Integration registry + policy configuration (ticket 57) ───────────── */

/**
 * Feature-local key namespaces with the entity kind at position 0 —
 * `['integration', scope, 'registry']` and `['policy', scope, 'list']` — so
 * the ChangeSet bridge's kind-prefix invalidation refetches them on every
 * committed integration/policy change, whoever commits it: this feature's
 * typed writes and the legacy `A.toggleIntegration`/`A.togglePolicy` actions
 * publish the same kinds through the one authority.
 */
export const integrationKeys = {
  registry: (scope: QueryScope) => consoleKeys.view('integration', scope, 'registry'),
}
export const policyKeys = {
  list: (scope: QueryScope) => consoleKeys.view('policy', scope, 'list'),
}

/** Query-backed integration registry for the current auth/project scope. */
export function useIntegrations() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useQuery({
    queryKey: integrationKeys.registry(scope),
    queryFn: async (): Promise<IntegrationsRead> => {
      const res = await services
        .settings(actor, scope.project)
        .getIntegrations({ actor, projectId: scope.project, corr: 'integration-registry' })
      if (!res.ok) throw new OrgReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed policy list (recorded toggles + recent per-policy audit). */
export function usePolicies() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useQuery({
    queryKey: policyKeys.list(scope),
    queryFn: async (): Promise<PoliciesRead> => {
      const res = await services
        .settings(actor, scope.project)
        .getPolicies({ actor, projectId: scope.project, corr: 'policy-list' })
      if (!res.ok) throw new OrgReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Write-side binding for integrations (ticket 57): connect/disconnect
 * (disconnect is the audited revoke) and the create-once access-key
 * re-entry. Refusals resolve as explicit ServiceResults for the panel to
 * render; a committed write publishes the `integration` ChangeSet the
 * analysis coverage indicator and this registry both observe.
 */
export function useIntegrationWrites() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useMemo(() => {
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    const svc = () => services.settings(actor, scope.project)
    return {
      setConnection: (id: string, action: IntegrationAction, reason: string): Promise<ServiceResult<Integration>> =>
        svc().setIntegrationConnection(ctx(action === 'disconnect' ? 'integration-disconnect' : 'integration-connect'), id, action, reason),
      reauthenticate: (id: string, key: string): Promise<ServiceResult<Integration>> =>
        svc().updateIntegrationKey(ctx('integration-key'), id, key),
    }
  }, [services, scope.project, actor])
}

/** Write-side binding for policy toggles (ticket 57); disable requires a reason. */
export function usePolicyWrites() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useMemo(() => {
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    return {
      setEnabled: (id: string, enabled: boolean, reason: string): Promise<ServiceResult<Policy>> =>
        services.settings(actor, scope.project).setPolicyEnabled(ctx('policy-toggle'), id, enabled, reason),
    }
  }, [services, scope.project, actor])
}

/* ───────────── Retention + canonical audit history (ticket 58) ───────────── */

/**
 * Feature-local key namespaces with the entity kind at position 0 —
 * `['retention', scope, 'list']` and `['audit', scope, 'list', query]` — so
 * the ChangeSet bridge's kind-prefix invalidation keeps both live: every
 * committed mutation (legacy or typed) appends its audit row, and retention
 * writes touch the retention row and the org hold list. Whoever commits, the
 * tabs refetch without a reload.
 */
export const retentionKeys = {
  list: (scope: QueryScope) => consoleKeys.view('retention', scope, 'list'),
}
export const auditKeys = {
  list: (scope: QueryScope, query: AuditQuery) => consoleKeys.view('audit', scope, 'list', query),
}

/** Query-backed retention read (policies, committed holds, filtered history). */
export function useRetention() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useQuery({
    queryKey: retentionKeys.list(scope),
    queryFn: async (): Promise<RetentionRead> => {
      const res = await services
        .settings(actor, scope.project)
        .getRetention({ actor, projectId: scope.project, corr: 'retention-list' })
      if (!res.ok) throw new OrgReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed audit history: the filter object is part of the query key. */
export function useAudit(query: AuditQuery) {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useQuery({
    queryKey: auditKeys.list(scope, query),
    queryFn: async (): Promise<AuditRead> => {
      const res = await services
        .settings(actor, scope.project)
        .getAudit({ actor, projectId: scope.project, corr: 'audit-list' }, query)
      if (!res.ok) throw new OrgReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Write-side binding for retention (ticket 58): policy save, legal hold
 * place/release and the simulated delete-under-policy. Refusals resolve as
 * explicit ServiceResults; a committed write publishes the retention/org
 * ChangeSet this tab and the audit history both observe.
 */
export function useRetentionWrites() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useMemo(() => {
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    const svc = () => services.settings(actor, scope.project)
    return {
      save: (id: string, patch: RetentionPatch): Promise<ServiceResult<Retention>> =>
        svc().updateRetention(ctx('retention-save'), id, patch),
      setHold: (id: string, held: boolean, reason: string): Promise<ServiceResult<Retention>> =>
        svc().setRetentionHold(ctx(held ? 'retention-hold' : 'retention-release'), id, held, reason),
      remove: (id: string, reason: string): Promise<ServiceResult<Retention>> =>
        svc().deleteRetentionData(ctx('retention-delete'), id, reason),
    }
  }, [services, scope.project, actor])
}
