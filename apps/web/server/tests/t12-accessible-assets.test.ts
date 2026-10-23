import { describe, expect, it } from 'vitest';
import { ScopeService } from '../src/services/scope-service.js';

/**
 * All-projects inventory: an asset is listed only when its project is readable as a viewer, every row names its project,
 * and the rows keep the per-project order. A project the actor cannot read contributes nothing.
 */

type Row = Record<string, unknown>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && 'in' in value) return (value as { in: unknown[] }).in.includes(row[key]);
    return row[key] === value;
  });
}

function fakeDb(input: { engagements: Row[]; memberships: Row[]; assets: Row[] }) {
  return {
    engagement: {
      findMany: async ({ where = {} }: { where?: Row }) => input.engagements.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      findFirst: async ({ where }: { where: Row }) => input.engagements.find((row) => matches(row, where)) ?? null,
    },
    webMembership: {
      findMany: async ({ where = {} }: { where?: Row }) => input.memberships.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      findFirst: async ({ where }: { where: Row }) => input.memberships.find((row) => matches(row, where)) ?? null,
    },
    webAsset: {
      findMany: async ({ where = {}, take }: { where?: Row; take?: number }) => {
        const rows = input.assets.filter((row) => matches(row, where)).sort((a, b) => String(a.engagementId).localeCompare(String(b.engagementId)) || String(a.identifier).localeCompare(String(b.identifier)));
        return take === undefined ? rows : rows.slice(0, take);
      },
    },
  };
}

const at = new Date('2026-10-20T08:00:00.000Z');
const asset = (id: string, engagementId: string, identifier: string, extra: Row = {}): Row => ({
  id, engagementId, identifier, kind: 'host', classification: 'pending', observed: false, version: 1, updatedAt: at, ...extra,
});

const engagements = [
  { id: 'eng-owned', name: 'owned', displayName: 'Reddish', userId: 'actor-1' },
  { id: 'eng-member', name: 'member', displayName: null, userId: 'someone-else' },
  { id: 'eng-foreign', name: 'foreign', displayName: 'Foreign', userId: 'someone-else' },
];
const memberships = [{ engagementId: 'eng-member', userId: 'actor-1', role: 'viewer' }];

describe('all-projects asset inventory', () => {
  it('lists the assets of every readable project, each named with its project, and nothing from a project the actor cannot read', async () => {
    const db = fakeDb({
      engagements,
      memberships,
      assets: [
        asset('as-1', 'eng-owned', 'app.lab.example.test'),
        asset('as-2', 'eng-member', 'vpn.lab.example.test', { observed: true }),
        asset('as-3', 'eng-foreign', 'secret.example.test'),
      ],
    });
    const service = new ScopeService(db as never);
    const view = await service.accessibleAssets('actor-1');
    expect(view.truncated).toBe(false);
    expect(view.assets.map((row) => row.id).sort()).toEqual(['as-1', 'as-2']);
    const byId = new Map(view.assets.map((row) => [row.id, row]));
    expect(byId.get('as-1')).toMatchObject({ engagementId: 'eng-owned', projectName: 'Reddish', identifier: 'app.lab.example.test' });
    expect(byId.get('as-2')).toMatchObject({ engagementId: 'eng-member', projectName: 'member', observed: true });
  });

  it('returns an empty list, not an error, when the actor can read no project', async () => {
    const service = new ScopeService(fakeDb({ engagements, memberships: [], assets: [asset('as-9', 'eng-foreign', 'x.example.test')] }) as never);
    expect(await service.accessibleAssets('actor-1')).toEqual({ assets: [], truncated: false, source: 'db' });
  });

  it('caps the rows at 1000 and says so when more assets exist', async () => {
    const many = Array.from({ length: 1001 }, (_, index) => asset(`as-${index}`, 'eng-owned', `host-${String(index).padStart(4, '0')}.example.test`));
    const service = new ScopeService(fakeDb({ engagements, memberships, assets: many }) as never);
    const view = await service.accessibleAssets('actor-1');
    expect(view.assets).toHaveLength(1000);
    expect(view.truncated).toBe(true);
  });
});
