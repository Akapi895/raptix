/** Scoped evidence labels and asset inspector choices for analysis views. */
import type { Asset, Evidence } from '../../domain/entities'
import type { ConsoleServices } from '../../domain/console-services';
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'

export interface AnalysisEvidenceRead { evidence: Pick<Evidence, 'id' | 'name' | 'kind' | 'sensitive'>[] }

export function readAnalysisEvidence(services: ConsoleServices, ctx: RequestContext, ids: string[]): AnalysisEvidenceRead {
  return projectView(services, ctx, `analysis-evidence:${JSON.stringify(ids)}`, (db) => ({ evidence: scopedRows(db, ctx, db.evidence).filter((e) => ids.includes(e.id)).map(({ id, name, kind, sensitive }) => ({ id, name, kind, sensitive })) }))
}

export function readAnalysisAssets(services: ConsoleServices, ctx: RequestContext): { assets: Asset[] } {
  return projectView(services, ctx, 'analysis-asset-inspectors', (db) => ({ assets: scopedRows(db, ctx, db.assets) }))
}

export function useAnalysisEvidence(ids: string[]): AnalysisEvidenceRead { return useServiceProjection((services, ctx) => readAnalysisEvidence(services, ctx, ids)) }
export function useAnalysisAssets(): { assets: Asset[] } { return useServiceProjection(readAnalysisAssets) }
