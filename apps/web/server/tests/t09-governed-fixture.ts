import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { GovernanceService, type PreflightCheck } from '../src/services/governance-service.js';
import { ScopeService } from '../src/services/scope-service.js';
import { registerGovernanceRoutes } from '../src/http/routes/governance.routes.js';

type Row = Record<string, unknown>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Row[]).some((part: Row) => matches(row, part));
    if (key === 'AND') return (value as Row[]).every((part: Row) => matches(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const filter = value as { in?: unknown[]; not?: unknown; lte?: unknown; lt?: unknown };
      if ('in' in filter) return filter.in!.includes(row[key]);
      if ('not' in filter) return row[key] !== filter.not;
      if ('lte' in filter) return Number(row[key]) <= Number(filter.lte);
      if ('lt' in filter) return Number(row[key]) < Number(filter.lt);
    }
    return row[key] === value;
  });
}

/** Persistence double only: production service and HTTP routing execute unchanged. */
export function governedFixture(readiness?: () => Promise<PreflightCheck[]>) {
  const tables: Record<string, Row[]> = {};
  const db: Row = {};
  interface QueryArgs { where?: Row; orderBy?: Record<string, string>; take?: number }
  for (const name of ['engagement', 'engagementClosure', 'engagementThread', 'businessPlan', 'operationBinding', 'emergencyStop', 'scopeRevision', 'webAsset', 'webMembership', 'webAuditEntry', 'webNotice', 'webRequestLedger']) {
    const rows: Row[] = tables[name] = [];
    const findMany = async ({ where, orderBy, take }: QueryArgs = {}): Promise<Row[]> => {
      let selected = rows.filter(row => matches(row, where ?? {}));
      if (orderBy) for (const [key, direction] of Object.entries(orderBy)) selected = selected.sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0) * (direction === 'desc' ? -1 : 1));
      return selected.slice(0, take).map(row => ({ ...row }));
    };
    db[name] = {
      findMany, findFirst: async (args: QueryArgs) => (await findMany(args))[0] ?? null,
      count: async (args: QueryArgs) => (await findMany(args)).length,
      create: async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), decidedBy: null, decidedAt: null, decisionComment: null, expiresAt: null, roeVersion: null, resolvedAt: null, resolvedBy: null, resolutionReason: null, concurrencyVersion: 1, scheduleState: null, scheduledAt: null, scheduleRequestId: null, scheduleMessage: null, dispatchError: null, runId: null, ...data };
        rows.push(row); return { ...row };
      },
      updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
        const selected = rows.filter(row => matches(row, where ?? {}));
        for (const row of selected) for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? Number(row[key]) + Number((value as { increment: unknown }).increment) : value;
        return { count: selected.length };
      },
      update: async ({ where, data }: { where?: Row; data: Row }) => {
        const row = rows.find(row => matches(row, where ?? {}));
        if (!row) throw new Error('Fixture row missing');
        Object.assign(row, data); return { ...row };
      },
    };
  }
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>) => fn(db);
  tables.engagement!.push({ id: 'eng', userId: 'owner', name: 'eng', targetValue: 'https://target.invalid', authorizationConfirmed: true, handoffConfirmedAt: new Date() });
  tables.engagementThread!.push({ engagementId: 'eng', threadId: 'thread', kind: 'execution' });
  tables.scopeRevision!.push({ id: 'scope', engagementId: 'eng', version: 1, status: 'approved', roe: { windows: [], emergencyContacts: ['blue@example.invalid'], restrictions: [] } });
  tables.webAsset!.push({ engagementId: 'eng', classification: 'in_scope' });
  const service = new GovernanceService(db as never, new ScopeService(db as never), { readiness });
  const app = Fastify();
  registerGovernanceRoutes(app, service, { id: 'owner' } as never);
  return { db, tables, service, app };
}

export const readyChecks = async (): Promise<PreflightCheck[]> => [{ id: 'runtime', state: 'pass', detail: 'Observed runtime catalog.' }];
