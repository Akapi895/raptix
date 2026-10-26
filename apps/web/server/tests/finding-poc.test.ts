import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { FindingPocService } from '../src/services/finding-poc-service.js';

const ENGAGEMENT = 'eng-1';
const OWNER = 'owner-1';
const VALUE = 'tok-SECRET-123';

function fakeDb(membershipRole: string | null) {
  const create = vi.fn(async () => ({}));
  const db = {
    engagement: { findFirst: vi.fn(async () => ({ id: ENGAGEMENT, userId: OWNER, workspaceSlug: 'codeparttwo' })) },
    webMembership: { findFirst: vi.fn(async () => (membershipRole === null ? null : { role: membershipRole })) },
    engagementClosure: { findFirst: vi.fn(async () => null) },
    webAuditEntry: { create },
  };
  return { db: db as unknown as PrismaClient, create };
}

function service(db: PrismaClient) {
  return new FindingPocService({
    db,
    runtimeApiUrl: 'http://web-runtime:2024',
    runtimeApiToken: 'runtime-token',
    sandboxKey: 'sandbox-key',
    perProjectSandbox: true,
  });
}

function runtimeAnswer(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FindingPocService.reproduce', () => {
  it('passes the run-time value to the runtime and keeps it out of the audit entry', async () => {
    const { db, create } = fakeDb(null);
    const fetchStub = runtimeAnswer({ finding_id: 'FIND-001', outcome: 'ran', reproduced: true });
    vi.stubGlobal('fetch', fetchStub);

    await service(db).reproduce(OWNER, ENGAGEMENT, 'FIND-001', { token: VALUE });

    const [url, init] = fetchStub.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://web-runtime:2024/_raptix/findings/FIND-001/reproduce');
    expect(JSON.parse(String(init.body)).token).toBe(VALUE);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer runtime-token');
    expect(JSON.stringify(create.mock.calls)).not.toContain(VALUE);
  });

  it('records an audit entry that names the outcome', async () => {
    const { db, create } = fakeDb(null);
    vi.stubGlobal('fetch', runtimeAnswer({ finding_id: 'FIND-001', outcome: 'refused', refusal: 'agent_halted: x' }));

    await service(db).reproduce(OWNER, ENGAGEMENT, 'FIND-001', {});

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'finding.poc_reproduced', targetId: 'FIND-001', reason: 'refused: agent_halted: x' }),
    });
  });

  it('refuses an actor who has no membership and never calls the runtime', async () => {
    const { db } = fakeDb(null);
    const fetchStub = runtimeAnswer({});
    vi.stubGlobal('fetch', fetchStub);

    await expect(service(db).reproduce('stranger', ENGAGEMENT, 'FIND-001', { token: VALUE })).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses a viewer, who may read the PoC but not run it', async () => {
    const { db } = fakeDb('viewer');
    const fetchStub = runtimeAnswer({});
    vi.stubGlobal('fetch', fetchStub);

    await expect(service(db).reproduce('viewer-1', ENGAGEMENT, 'FIND-001', { token: VALUE })).rejects.toMatchObject({ statusCode: 403 });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses a reference that is not a workspace finding id', async () => {
    const { db } = fakeDb(null);
    const fetchStub = runtimeAnswer({});
    vi.stubGlobal('fetch', fetchStub);

    await expect(service(db).reproduce(OWNER, ENGAGEMENT, '../FIND-001', {})).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
