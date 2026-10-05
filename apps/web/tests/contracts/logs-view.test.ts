import { describe, expect, it } from 'vitest'
import type { TimelineView } from '@raptix/web-contracts'
import {
  entryProvenance,
  entrySearchText,
  filterOptions,
  filterTimeline,
  SOURCE_LABELS,
  timelineSummary,
} from '../../src/features/operations-log/logs-view'

const view: TimelineView = {
  engagementId: 'eng-1',
  truncated: false,
  source: 'mixed',
  entries: [
    { id: 'run:run-9', at: '2026-10-01T08:00:00.000Z', source: 'runtime', kind: 'run', label: 'Planning run success', runId: 'run-9', status: 'success' },
    { id: 'checkpoint:0', at: '2026-10-01T09:30:00.000Z', source: 'checkpoint', kind: 'tool_call', label: 'tool call', agent: 'soundwave' },
    { id: 'workspace:recon/nmap.txt', at: '2026-10-01T10:00:00.000Z', source: 'workspace', kind: 'artifact', label: 'Artifact updated: recon/nmap.txt', tool: 'recon' },
  ],
}

describe('W14 operations-log mapping', () => {
  it('derives filter options from the actual payload, never hardcoded lists', () => {
    expect(filterOptions(view, entry => entry.agent)).toEqual(['all', 'soundwave'])
    expect(filterOptions(view, entry => entry.tool)).toEqual(['all', 'recon'])
    expect(filterOptions(view, entry => entry.status)).toEqual(['all', 'success'])
  })

  it('filters by source, derived values and search without conflating labels', () => {
    const runtimeOnly = filterTimeline(view, { source: 'runtime', agent: 'all', tool: 'all', status: 'all', search: '' })
    expect(runtimeOnly.map(entry => entry.id)).toEqual(['run:run-9'])
    const byAgent = filterTimeline(view, { source: 'all', agent: 'soundwave', tool: 'all', status: 'all', search: '' })
    expect(byAgent.map(entry => entry.id)).toEqual(['checkpoint:0'])
    const bySearch = filterTimeline(view, { source: 'all', agent: 'all', tool: 'all', status: 'all', search: 'nmap' })
    expect(bySearch.map(entry => entry.id)).toEqual(['workspace:recon/nmap.txt'])
  })

  it('states bounded history and provenance truthfully', () => {
    expect(timelineSummary(view)).toBe('3 entries')
    expect(timelineSummary({ ...view, truncated: true })).toContain('bounded')
    expect(entryProvenance(view.entries[2]!)).toContain('not an exact tool execution time')
    expect(entryProvenance(view.entries[1]!)).toContain('replay context')
    expect(entryProvenance(view.entries[0]!)).toContain('one merged record')
    expect(SOURCE_LABELS.workspace).toBe('Workspace')
    expect(entrySearchText(view.entries[0]!)).toContain('run-9')
  })
})
