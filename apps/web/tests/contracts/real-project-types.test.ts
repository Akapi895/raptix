import { describe, expect, it } from 'vitest'
import type { ProjectViewModel } from '@raptix/web-contracts'
import {
  countByLifecycle,
  filterRealProjects,
  formatPublicCount,
  formatUpdatedAt,
  validateCreateProjectDraft,
} from '../../src/features/projects/real-project.types'

function project(overrides: Partial<ProjectViewModel> = {}): ProjectViewModel {
  return {
    id: 'eng-1',
    workspaceSlug: 'acme-corp',
    displayName: 'ACME Corp Web Pentest',
    targetType: 'web_url',
    targetValue: 'http://authorized-local-target:3010',
    authorizationConfirmed: true,
    brief: null,
    handoffConfirmedAt: null,
    metadataState: 'verified',
    lifecycleStatus: 'running',
    findingCount: null,
    assetCount: 12,
    activeAgentCount: null,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-02-20T12:30:00Z',
    ...overrides,
  }
}

describe('real-project public count/date formatting', () => {
  it('renders null counts as an em dash, never 0', () => {
    expect(formatPublicCount(null)).toBe('—')
    expect(formatPublicCount(0)).toBe('0')
    expect(formatPublicCount(3)).toBe('3')
  })

  it('formats ISO dates and falls back to an em dash for invalid input', () => {
    expect(formatUpdatedAt('2026-02-20T12:30:00Z')).toContain('2026')
    expect(formatUpdatedAt('not-a-date')).toBe('—')
  })
})

describe('real-project filtering', () => {
  const projects = [
    project(),
    project({ id: 'eng-2', workspaceSlug: 'corp-net', displayName: 'Corp Net Sweep', targetValue: '10.0.0.0/24', lifecycleStatus: 'draft' }),
    project({ id: 'eng-3', workspaceSlug: 'old-scan', displayName: 'Old Scan', lifecycleStatus: 'completed' }),
  ]

  it('filters by actual fields: displayName, workspaceSlug and targetValue', () => {
    expect(filterRealProjects(projects, 'acme', 'all')).toHaveLength(1)
    expect(filterRealProjects(projects, 'corp-net', 'all')).toHaveLength(1)
    expect(filterRealProjects(projects, '10.0.0.0', 'all')).toHaveLength(1)
    expect(filterRealProjects(projects, 'no-match', 'all')).toHaveLength(0)
    expect(filterRealProjects(projects, '  ACME  ', 'all')).toHaveLength(1)
  })

  it('filters by real lifecycle statuses and counts them', () => {
    expect(filterRealProjects(projects, '', 'draft')).toHaveLength(1)
    expect(filterRealProjects(projects, '', 'running')).toHaveLength(1)
    expect(filterRealProjects(projects, '', 'failed')).toHaveLength(0)
    expect(filterRealProjects(projects, 'corp', 'draft')).toHaveLength(1)
    expect(filterRealProjects(projects, 'corp', 'completed')).toHaveLength(0)
    expect(countByLifecycle(projects, 'completed')).toBe(1)
    expect(countByLifecycle(projects, 'planning')).toBe(0)
  })
})

describe('real-project create draft validation', () => {
  const valid = {
    name: 'acme-corp-web-pentest',
    displayName: 'ACME Corp Web Pentest',
    targetType: 'web_url' as const,
    targetValue: 'http://authorized-local-target:3010',
    authorizationConfirmed: true,
    brief: 'Authorized external web assessment of the local lab target with defined constraints.',
  }

  it('accepts a fully valid draft', () => {
    expect(validateCreateProjectDraft(valid)).toEqual({})
  })

  it('requires a briefing of usable length and bounds its size', () => {
    expect(validateCreateProjectDraft({ ...valid, brief: '' }).brief).toBeDefined()
    expect(validateCreateProjectDraft({ ...valid, brief: 'too short' }).brief).toBeDefined()
    expect(validateCreateProjectDraft({ ...valid, brief: 'x'.repeat(20_001) }).brief).toBeDefined()
    expect(validateCreateProjectDraft({ ...valid, brief: 'x'.repeat(20_000) }).brief).toBeUndefined()
  })

  it('rejects workspace slugs that violate the server slug policy', () => {
    for (const name of ['Acme Corp', 'ab', '-acme-', 'acme-', 'acme/corp', 'acme\\corp', 'a'.repeat(65)]) {
      expect(validateCreateProjectDraft({ ...valid, name }).name).toContain('3-64 chars')
    }
  })

  it('rejects web_url targets the server policy rejects', () => {
    for (const targetValue of ['', 'http://host with space', 'not a url', 'ftp://host', '/relative/path', 'http://user:pass@host']) {
      expect(validateCreateProjectDraft({ ...valid, targetValue }).targetValue).toBeDefined()
    }
  })

  it('lets the server own exact ip_range validation but rejects empty/whitespace values', () => {
    expect(validateCreateProjectDraft({ ...valid, targetType: 'ip_range', targetValue: '10.0.0.0/24' }).targetValue).toBeUndefined()
    expect(validateCreateProjectDraft({ ...valid, targetType: 'ip_range', targetValue: '' }).targetValue).toBeDefined()
    expect(validateCreateProjectDraft({ ...valid, targetType: 'ip_range', targetValue: '10.0.0.0 24' }).targetValue).toBeDefined()
  })

  it('requires explicit authorization confirmation and bounds displayName', () => {
    expect(validateCreateProjectDraft({ ...valid, authorizationConfirmed: false }).authorizationConfirmed).toBeDefined()
    expect(validateCreateProjectDraft({ ...valid, displayName: 'x'.repeat(201) }).displayName).toBeDefined()
    expect(validateCreateProjectDraft({ ...valid, displayName: 'x'.repeat(200) }).displayName).toBeUndefined()
  })
})
