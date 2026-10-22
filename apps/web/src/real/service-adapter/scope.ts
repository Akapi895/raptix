import type { RequestContext, ServiceResult } from '../../domain/service'
import type { ScopeRead, ScopeRevision, ScopeService } from '../../features/scope/service'
import { decideScopeRevision, fetchEffectiveScope, fetchScopeRevisions, submitScopeRevision, type ScopeRevisionView } from '../../features/scope/remote';
import { guarded } from '../../platform/adapter-shared'

/** The engagement id is the console's project id in real mode. */
function engagementOf(ctx: RequestContext): string | null {
  return ctx.projectId && ctx.projectId !== 'all' ? ctx.projectId : null
}

function toRevision(view: ScopeRevisionView): ScopeRevision {
  return {
    id: view.id,
    version: view.version,
    status: view.status,
    diff: { added: view.diff.added, removed: view.diff.removed, rationale: view.diff.rationale },
    roe: { windows: view.roe.windows, emergencyContacts: view.roe.emergencyContacts, restrictions: view.roe.restrictions },
    requestedBy: view.requestedBy,
    decidedBy: view.decidedBy,
    decisionComment: view.decisionComment,
  }
}

const NO_ENGAGEMENT = { kind: 'validation' as const, message: 'Select an engagement before reading or changing its scope.' }

export function createRealScopeService(): ScopeService {
  return {
    read: (ctx) => guarded(async (): Promise<ServiceResult<ScopeRead>> => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const [revisions, effective] = await Promise.all([fetchScopeRevisions(engagementId), fetchEffectiveScope(engagementId)])
      return {
        ok: true,
        data: {
          revisions: revisions.revisions.map(toRevision),
          latestApprovedVersion: revisions.latestApprovedVersion,
          effective: {
            version: effective.version,
            versionLabel: effective.version === null ? null : `v${effective.version}`,
            rootTarget: effective.rootTarget,
            inScope: effective.inScope,
            roe: effective.roe,
            windowText: effective.roe.windows.length === 0 ? null : effective.roe.windows.map((w) => `${w.start} → ${w.end} (${w.tz})`).join(' · '),
          },
          // The backend has no operations, plans or documents model yet, so a scope change has no impact list here.
          impact: null,
          unmodelled: ['operations', 'plans', 'documents'],
          supports: { roeFields: true },
        },
      }
    }),
    submit: (ctx, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: toRevision(await submitScopeRevision(engagementId, input)) }
    }),
    decide: (ctx, revisionId, decision) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: toRevision(await decideScopeRevision(engagementId, revisionId, decision)) }
    }),
  }
}
