import { isTimelineView, isGraphView, type TimelineView, type GraphView } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';
import { owned } from '../planning/remote';

export function fetchTimeline(engagementId: string): Promise<TimelineView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/timeline`, owned(engagementId, isTimelineView))
}

export function fetchGraph(engagementId: string): Promise<GraphView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/graph`, owned(engagementId, isGraphView))
}

export interface ObservedTechniqueView {
  techniqueId: string
  label: string | null
  nodeIds: string[]
}

export interface AnalysisPathView {
  id: string
  steps: { nodeId: string; techniqueId: string | null; label: string | null }[]
}

export interface AnalysisView {
  engagementId: string
  observed: ObservedTechniqueView[]
  coverage: { observedTechniques: number; corpusTechniques: number | null; inCorpus: number | null }
  paths: AnalysisPathView[]
  quality: { graph: 'available' | 'empty'; truncated: boolean }
  excludedActions: string[]
  source: 'graph'
}

export function isAnalysisView(v: unknown): v is AnalysisView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as AnalysisView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.observed) && Array.isArray(doc.paths) && doc.source === 'graph'
}

export function fetchAnalysis(engagementId: string): Promise<AnalysisView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/analysis`, owned(engagementId, isAnalysisView))
}
