import { describe, expect, it } from 'vitest';
import { FindingsWorkflowService } from '../src/services/findings-workflow-service.js';

/**
 * Cross-project finding list: a finding is listed only when the actor can read its project as a viewer, each row names
 * its project and target, and the newest update comes first. Other projects' findings never leak into the list.
 */

type Row = Record<string, unknown>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && 'in' in value) return (value as { in: unknown[] }).in.includes(row[key]);
    return row[key] === value;
  });
}

function pick(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function fakeDb(input: { engagements: Row[]; memberships: Row[]; findings: Row[]; dispositions?: Row[] }) {
  return {
    engagement: {
      findMany: async ({ where = {}, select }: { where?: Row; select?: Record<string, boolean> }) => input.engagements.filter((row) => matches(row, where)).map((row) => pick(row, select)),
      findFirst: async ({ where }: { where: Row }) => input.engagements.find((row) => matches(row, where)) ?? null,
    },
    webMembership: {
      findMany: async ({ where = {}, select }: { where?: Row; select?: Record<string, boolean> }) => input.memberships.filter((row) => matches(row, where)).map((row) => pick(row, select)),
      findFirst: async ({ where }: { where: Row }) => input.memberships.find((row) => matches(row, where)) ?? null,
    },
    findingSuggestionDisposition: {
      findMany: async ({ where = {} }: { where?: Row }) => (input.dispositions ?? []).filter((row) => matches(row, where)),
    },
    findingRecord: {
      findMany: async ({ where = {}, take }: { where?: Row; take?: number }) => {
        const rows = input.findings.filter((row) => matches(row, where)).sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime());
        return take === undefined ? rows : rows.slice(0, take);
      },
    },
  };
}

const at = (minutesAgo: number) => new Date(Date.parse('2026-10-20T08:00:00.000Z') - minutesAgo * 60_000);

const engagements = [
  { id: 'eng-owned', name: 'owned', displayName: 'Northwind Bank', workspaceSlug: 'northwind', targetValue: 'https://northwind.example.test', userId: 'actor-1' },
  { id: 'eng-member', name: 'member', displayName: null, workspaceSlug: 'member', targetValue: '10.20.0.0/24', userId: 'someone-else' },
  { id: 'eng-client', name: 'client', displayName: 'Client only', workspaceSlug: 'client', targetValue: 'https://client.example.test', userId: 'someone-else' },
  { id: 'eng-foreign', name: 'foreign', displayName: 'Foreign', workspaceSlug: 'foreign', targetValue: 'https://foreign.example.test', userId: 'someone-else' },
];

const memberships = [
  { engagementId: 'eng-member', userId: 'actor-1', role: 'viewer' },
  { engagementId: 'eng-client', userId: 'actor-1', role: 'client' },
];

const finding = (id: string, engagementId: string, minutesAgo: number, overrides: Row = {}): Row => ({
  id, engagementId, title: `Finding ${id}`, severity: 'high', status: 'draft', sourceType: 'authored', techniqueId: null,
  createdAt: at(minutesAgo + 60), updatedAt: at(minutesAgo), ...overrides,
});

describe('cross-project curated finding list', () => {
  it('lists only findings of projects the actor can read, newest update first, each named with its project and target', async () => {
    const db = fakeDb({
      engagements,
      memberships,
      findings: [
        finding('FD-1', 'eng-owned', 30, { severity: 'critical', status: 'confirmed', techniqueId: 'T1078' }),
        finding('FD-2', 'eng-member', 5, { status: 'review', body: { detail: 'Shared service account is reachable from the DMZ' } }),
        finding('FD-3', 'eng-client', 1),
        finding('FD-4', 'eng-foreign', 2),
      ],
    });
    const service = new FindingsWorkflowService(db as never);
    const view = await service.listAccessible('actor-1');
    expect(view.truncated).toBe(false);
    expect(view.findings.map((row) => row.id)).toEqual(['FD-2', 'FD-1']);
    expect(view.findings[0]).toMatchObject({ engagementId: 'eng-member', projectName: 'member', targetValue: '10.20.0.0/24', status: 'review', description: 'Shared service account is reachable from the DMZ' });
    expect(view.findings[1]).toMatchObject({ engagementId: 'eng-owned', projectName: 'Northwind Bank', targetValue: 'https://northwind.example.test', severity: 'critical', techniqueId: 'T1078', description: null });
  });

  it('returns an empty list, not an error, when the actor can read no project', async () => {
    const service = new FindingsWorkflowService(fakeDb({ engagements, memberships: [], findings: [finding('FD-9', 'eng-foreign', 1)] }) as never);
    expect(await service.listAccessible('actor-1')).toEqual({ findings: [], truncated: false, source: 'db' });
  });

  it('adds the runtime claims of readable projects, leaving out the ones a curated record imports or the actor dismissed', async () => {
    const claim = (id: string, engagementId: string) => ({
      id, engagementId, title: `Claim ${id}`, severity: 'medium', description: `Runtime claim ${id}`, mitre: ['T1190'], affectedAssets: [],
      evidence: '', attackVector: '', quality: { defaultSeverity: false, placeholderDescription: false, placeholderEvidence: false, unreadable: false },
      rawSource: '', sizeBytes: 1, source: 'workspace',
    });
    const producers = {
      list: async (_actorId: string, engagementId: string) => ({
        engagementId, source: 'workspace', truncated: false,
        findings: engagementId === 'eng-owned' ? [claim('FIND-001', engagementId), claim('FIND-002', engagementId), claim('FIND-004', engagementId)] : [claim('FIND-009', engagementId), claim('FIND-010', engagementId)],
      }),
    };
    const db = fakeDb({
      engagements,
      memberships,
      findings: [finding('FD-1', 'eng-owned', 30, { sourceType: 'imported', producerRef: 'findings/FIND-001.md' })],
      dispositions: [{ engagementId: 'eng-owned', actorId: 'actor-1', producerRef: 'findings/FIND-004.md', dismissed: true }],
    });
    const service = new FindingsWorkflowService(db as never, undefined, undefined, producers as never);
    const view = await service.listAccessible('actor-1');
    expect(view.findings.map((row) => row.id)).toEqual(['FD-1', 'FIND-002', 'FIND-009', 'FIND-010']);
    expect(view.findings[1]).toMatchObject({ engagementId: 'eng-owned', projectName: 'Northwind Bank', status: 'ai_suggested', sourceType: 'producer', techniqueId: 'T1190', description: 'Runtime claim FIND-002', createdAt: null, updatedAt: null });
  });

  it('caps the rows at 1000 and says so when more findings exist', async () => {
    const many = Array.from({ length: 1001 }, (_, index) => finding(`FD-${index}`, 'eng-owned', index));
    const service = new FindingsWorkflowService(fakeDb({ engagements, memberships, findings: many }) as never);
    const view = await service.listAccessible('actor-1');
    expect(view.findings).toHaveLength(1000);
    expect(view.truncated).toBe(true);
  });
});
