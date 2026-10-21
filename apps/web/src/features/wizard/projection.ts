/** Wizard reference options expose codes, clients and accessible asset identifiers only. */
import { projectAccessible } from '../../domain/policy'
import type { ConsoleServices } from '../../domain/console-services';
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'

export interface WizardReferences {
  projectIds: string[]
  clients: string[]
  assetIdentifiers: { ident: string; projectId: string }[]
}

export function readWizardReferences(services: ConsoleServices, ctx: RequestContext): WizardReferences {
  return projectView(services, ctx, 'wizard-references', (db) => {
    const projects = db.projects.filter((p) => projectAccessible(p, ctx.actor))
    return {
      projectIds: projects.map((p) => p.id), clients: [...new Set(projects.map((p) => p.client))],
      assetIdentifiers: scopedRows(db, { ...ctx, projectId: 'all' }, db.assets).map((a) => ({ ident: a.ident, projectId: a.projectId })),
    }
  })
}

export function useWizardReferences(): WizardReferences {
  return useServiceProjection(readWizardReferences, 'all')
}
