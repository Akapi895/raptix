/**
 * The effective-scope decisions: the root target is always in scope, an approved target names the revision that approved it,
 * an excluded asset is never a target, a pending asset waits for its revision, and an asset recorded as in scope without an
 * approved grant is named as a mismatch rather than allowed. The ROE policies name what the console cannot report.
 */
import { describe, expect, it } from 'vitest'
import type { Asset } from '../../domain/entities'
import type { AssetListItem } from '../assets'
import { effectiveRows, NOT_MODELLED, policyRows } from './effective'
import type { ScopeRead, ScopeRevision } from './service'

function asset(overrides: Partial<Asset>): AssetListItem {
  return {
    asset: { id: 'a-1', name: 'host', ident: 'host.lab', ip: '', type: 'Host', os: '', owner: '', projectId: 'eng-1', scope: 'unclassified', source: 'managed', updated: '2026-10-20T09:00:00Z', observation: null, ...overrides },
  }
}

function revision(overrides: Partial<ScopeRevision>): ScopeRevision {
  return {
    id: 'r-1',
    version: 1,
    status: 'approved',
    diff: { added: [], removed: [], rationale: 'scope' },
    roe: { windows: [], emergencyContacts: ['blue@lab.invalid'], restrictions: [] },
    requestedBy: 'u-owner',
    decidedBy: 'u-reviewer',
    decisionComment: null,
    ...overrides,
  }
}

function read(overrides: { revisions?: ScopeRevision[]; inScope?: string[]; windows?: ScopeRead['effective']['roe']['windows']; contacts?: string[] } = {}): ScopeRead {
  return {
    revisions: overrides.revisions ?? [],
    latestApprovedVersion: 1,
    effective: {
      version: 1,
      versionLabel: 'v1',
      rootTarget: 'app.lab.internal',
      inScope: overrides.inScope ?? [],
      roe: { windows: overrides.windows ?? [], emergencyContacts: overrides.contacts ?? ['blue@lab.invalid'], restrictions: [] },
      windowText: null,
    },
    impact: null,
    unmodelled: [],
    supports: { roeFields: true },
  }
}

describe('effective scope decisions', () => {
  it('names the engagement root as always in scope', () => {
    const rows = effectiveRows(read(), [])
    expect(rows).toEqual([expect.objectContaining({ target: 'app.lab.internal', decision: 'in', source: 'Engagement root target' })])
  })

  it('names the approved revision that added a target, and ignores a pending one', () => {
    const rows = effectiveRows(read({
      inScope: ['10.0.0.5'],
      revisions: [
        revision({ id: 'r-1', version: 1, diff: { added: ['10.0.0.5'], removed: [], rationale: 'first' } }),
        revision({ id: 'r-2', version: 2, status: 'pending', diff: { added: ['10.0.0.5'], removed: [], rationale: 'again' } }),
      ],
    }), [])
    expect(rows.find((row) => row.target === '10.0.0.5')).toMatchObject({ decision: 'in', source: 'Approved revision v1' })
  })

  it('excludes an out-of-scope asset with its reason and never allows it', () => {
    const rows = effectiveRows(read(), [asset({ ident: 'legacy.lab', scope: 'out' })])
    expect(rows.find((row) => row.target === 'legacy.lab')).toMatchObject({ decision: 'excluded', reason: 'Marked out of scope on the asset; never a target' })
  })

  it('keeps a pending asset pending until a revision approves it, and names that revision', () => {
    const rows = effectiveRows(read({ revisions: [revision({ id: 'r-2', version: 2, status: 'pending' })] }), [asset({ ident: 'db.lab', scope: 'pending' })])
    expect(rows.find((row) => row.target === 'db.lab')).toMatchObject({ decision: 'pending', source: 'Pending revision v2' })
  })

  it('names an asset recorded as in scope without an approved grant as a mismatch, not as allowed', () => {
    const rows = effectiveRows(read({ inScope: [] }), [asset({ ident: 'web.lab', scope: 'in' })])
    expect(rows.find((row) => row.target === 'web.lab')).toMatchObject({ decision: 'in', source: 'Asset record only' })
    expect(rows.find((row) => row.target === 'web.lab')?.reason).toContain('absent from the effective version')
  })

  it('links a row to its asset when the target is an inventory identifier', () => {
    const rows = effectiveRows(read({ inScope: ['web.lab'] }), [asset({ id: 'a-9', ident: 'web.lab', scope: 'in' })])
    expect(rows.find((row) => row.target === 'web.lab')?.assetId).toBe('a-9')
  })
})

describe('ROE policies', () => {
  it('shows a missing emergency contact as missing, and an empty testing window as always allowed', () => {
    const rows = policyRows(read({ contacts: [] }))
    expect(rows.find((row) => row.policy === 'Emergency contact')?.value).toBe('Missing')
    expect(rows.find((row) => row.policy === 'Testing window')?.value).toBe('None (always allowed)')
  })

  it('names the policies the backend does not model, and never reports them as enforced', () => {
    const rows = policyRows(read())
    const unmodelled = rows.filter((row) => row.value === NOT_MODELLED)
    expect(unmodelled.map((row) => row.policy)).toEqual(['Objectives', 'Allowed activities', 'Operational limits', 'Data handling', 'Abort & cleanup'])
    expect(rows.filter((row) => row.enforcement.startsWith('Not reported')).length).toBeGreaterThan(0)
    expect(rows.some((row) => row.enforcement.toLowerCase().includes('enforced') && !row.enforcement.startsWith('Not'))).toBe(false)
  })
})
