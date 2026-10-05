/**
 * W14 pure operations-log mapping: filter options derive from the actual
 * timeline payload (no hardcoded agent/tool lists), entries keep their source
 * labels, and the summary states trace completeness truthfully.
 */
import type { TimelineEntryView, TimelineView } from '@raptix/web-contracts'

export type SourceFilter = 'all' | TimelineEntryView['source']

export interface TimelineFilters {
  source: SourceFilter
  agent: string
  tool: string
  status: string
  search: string
}

export const SOURCE_LABELS: Record<TimelineEntryView['source'], string> = {
  runtime: 'Run',
  checkpoint: 'Checkpoint',
  workspace: 'Workspace',
}

const ALL = 'all'

function distinctValues(entries: TimelineEntryView[], pick: (entry: TimelineEntryView) => string | undefined): string[] {
  const values = new Set<string>()
  for (const entry of entries) {
    const value = pick(entry)
    if (value !== undefined && value.length > 0) values.add(value)
  }
  return [...values].sort()
}

export function filterOptions(view: TimelineView, pick: (entry: TimelineEntryView) => string | undefined): string[] {
  return [ALL, ...distinctValues(view.entries, pick)]
}

export function filterTimeline(view: TimelineView, filters: TimelineFilters): TimelineEntryView[] {
  const needle = filters.search.trim().toLowerCase()
  return view.entries.filter(entry => {
    if (filters.source !== ALL && entry.source !== filters.source) return false
    if (filters.agent !== ALL && (entry.agent ?? '') !== filters.agent) return false
    if (filters.tool !== ALL && (entry.tool ?? '') !== filters.tool) return false
    if (filters.status !== ALL && (entry.status ?? '') !== filters.status) return false
    if (needle.length > 0 && !entrySearchText(entry).includes(needle)) return false
    return true
  })
}

export function entrySearchText(entry: TimelineEntryView): string {
  return [entry.label, entry.kind, entry.agent, entry.tool, entry.runId, entry.status, SOURCE_LABELS[entry.source]]
    .filter(part => part !== undefined)
    .join(' ')
    .toLowerCase()
}

export function timelineSummary(view: TimelineView): string {
  const base = `${view.entries.length} entries`
  return view.truncated ? `${base} · bounded — older entries hidden by the server` : base
}

export function entryProvenance(entry: TimelineEntryView): string {
  if (entry.source === 'workspace') {
    return 'Workspace marker: the file timestamp records when the artifact was last written; it is not an exact tool execution time.'
  }
  if (entry.source === 'checkpoint') {
    return 'Checkpoint transcript: durable thread-level history. It is replay context, not a duplicate run event; runId stays unattributed by contract.'
  }
  return 'Runtime entry: one merged record per owned run accepted by the new API.'
}

export function formatEntryTime(at: string): string {
  const parsed = new Date(at)
  return Number.isNaN(parsed.getTime()) ? at : parsed.toLocaleString()
}
