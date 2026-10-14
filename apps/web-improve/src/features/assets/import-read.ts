/** Synchronous import duplicate identifiers and validation, scoped to the selected project. */
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'
import { projectAccessible } from '../../auth/policy'
import { validateAssetRows, type AssetImportRow, type AssetRowIssue } from './writes'

export interface AssetImportRead {
  assets: { projectId: string; ident: string }[]
  validate(projectId: string, rows: readonly AssetImportRow[]): AssetRowIssue[]
}

export function readAssetImport(services: ConsoleServices, ctx: RequestContext): AssetImportRead {
  return projectView(services, ctx, 'asset-import-preview', (db) => ({
    assets: scopedRows(db, ctx, db.assets).map(({ projectId, ident }) => ({ projectId, ident })),
    validate: (projectId, rows) => projectId === ctx.projectId && projectAccessible(db.projects.find((p) => p.id === projectId), ctx.actor) ? validateAssetRows(db, projectId, rows) : rows.map((r, index) => ({ index, name: r.name, duplicate: false, reasons: ['Select an accessible project before validating the import.'] })),
  }))
}

export function useAssetImportRead(): AssetImportRead { return useServiceProjection(readAssetImport) }
