import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { isCampaignJobView, isCampaignView, isCampaignsView } from '@raptix/web-contracts';
import { registerErrorHandler } from '../src/http/error-handler.js';
import { registerCampaignRoutes } from '../src/http/routes/campaign.routes.js';
import { buildCapabilitiesResponse } from '../src/http/routes/capabilities.routes.js';
import { CampaignService, toCampaignView } from '../src/services/campaign-service.js';
import { C2Service } from '../src/services/c2-service.js';
import { ProjectApiError } from '../src/services/projects-service.js';

const IDENTITY = { id: 'local', mode: 'local-single-user' } as const;
const ENGAGEMENT = { id: 'eng-1', userId: 'local', name: 'w17-slug', displayName: null, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true, status: 'planning', threadId: 'th-1', workspacePath: null, runtimeContextLockedAt: new Date('2026-10-02T00:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') } as const;

interface CampaignRow {
  id: string;
  engagementId: string;
  name: string;
  vector: string;
  status: string;
  version: number;
  spec: unknown;
  createdAt: Date;
  updatedAt: Date;
}
interface JobRow {
  id: string;
  campaignId: string;
  kind: string;
  status: string;
  provider: string | null;
  error: string | null;
  createdAt: Date;
}

function buildDb() {
  const campaigns: CampaignRow[] = [];
  const jobs: JobRow[] = [];
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${++seq}`;
  const withJobs = (row: CampaignRow) => ({ ...row, jobs: jobs.filter(job => job.campaignId === row.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) });
  return {
    campaigns,
    jobs,
    engagement: { findFirst: async ({ where }: { where: { id: string; userId: string } }) => (where.id === ENGAGEMENT.id && where.userId === ENGAGEMENT.userId ? { ...ENGAGEMENT } : null) },
    campaign: {
      findMany: async () => campaigns.map(withJobs),
      findFirst: async ({ where }: { where: { id: string; engagementId: string } }) => {
        const row = campaigns.find(candidate => candidate.id === where.id && candidate.engagementId === where.engagementId);
        return row ? withJobs(row) : null;
      },
      create: async ({ data }: { data: Omit<CampaignRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
        if (campaigns.some(candidate => candidate.engagementId === data.engagementId && candidate.name === data.name)) {
          const conflict = new Error('unique constraint failed') as Error & { code: string };
          conflict.code = 'P2002';
          throw conflict;
        }
        const row: CampaignRow = { ...data, id: nextId('camp'), createdAt: new Date('2026-10-02T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z') };
        campaigns.push(row);
        return withJobs(row);
      },
    },
    campaignJob: {
      create: async ({ data }: { data: Omit<JobRow, 'id' | 'createdAt'> }) => {
        const row: JobRow = { ...data, id: nextId('job'), createdAt: new Date('2026-10-02T00:01:00Z') };
        jobs.push(row);
        return row;
      },
    },
  } as never;
}

function buildApp(): FastifyInstance {
  const db = buildDb();
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerCampaignRoutes(app, new CampaignService(db), new C2Service(db), IDENTITY);
  return app;
}

describe('W17 campaign drafts', () => {
  it('creates and lists persisted drafts with valid DTOs', async () => {
    const app = buildApp();
    const created = await app.inject({ method: 'POST', url: '/api/engagements/eng-1/campaigns', payload: { name: 'Phishing Wave 1', vector: 'phishing', scenario: 'it-security-alert' } });
    expect(created.statusCode).toBe(201);
    const campaign = created.json();
    expect(isCampaignView(campaign)).toBe(true);
    expect(campaign.status).toBe('draft');
    expect(campaign.version).toBe(1);
    expect(campaign.spec).toEqual({ scenario: 'it-security-alert' });
    expect(campaign.jobs).toEqual([]);
    const list = await app.inject({ method: 'GET', url: '/api/engagements/eng-1/campaigns' });
    expect(list.statusCode).toBe(200);
    const view = list.json();
    expect(isCampaignsView(view)).toBe(true);
    expect(view.truncated).toBe(false);
    expect(view.campaigns).toHaveLength(1);
    expect(view.campaigns[0].name).toBe('Phishing Wave 1');
  });

  it('rejects invalid drafts with field attribution and duplicate names with 409', async () => {
    const app = buildApp();
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-1/campaigns', payload: { name: '', vector: 'phishing' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-1/campaigns', payload: { name: 'X', vector: 'sms' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-1/campaigns', payload: { name: 'X', vector: 'web', scenario: 42 } })).statusCode).toBe(400);
    const first = await app.inject({ method: 'POST', url: '/api/engagements/eng-1/campaigns', payload: { name: 'Same Name', vector: 'web' } });
    expect(first.statusCode).toBe(201);
    const duplicate = await app.inject({ method: 'POST', url: '/api/engagements/eng-1/campaigns', payload: { name: 'Same Name', vector: 'phishing' } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.message).toContain('Same Name');
  });

  it('records generate/deploy attempts as truthful unavailable jobs and never mutates the draft', async () => {
    const app = buildApp();
    const created = (await app.inject({ method: 'POST', url: '/api/engagements/eng-1/campaigns', payload: { name: 'Wave A', vector: 'mobile' } })).json();
    const generate = await app.inject({ method: 'POST', url: `/api/engagements/eng-1/campaigns/${created.id}/generate` });
    expect(generate.statusCode).toBe(200);
    const job = generate.json();
    expect(isCampaignJobView(job)).toBe(true);
    expect(job.kind).toBe('generate');
    expect(job.status).toBe('unavailable');
    expect(job.provider).toBeNull();
    expect(job.error).toContain('provider not configured');
    const deploy = (await app.inject({ method: 'POST', url: `/api/engagements/eng-1/campaigns/${created.id}/deploy` })).json();
    expect(deploy.kind).toBe('deploy');
    expect(deploy.status).toBe('unavailable');
    const reloaded = (await app.inject({ method: 'GET', url: `/api/engagements/eng-1/campaigns/${created.id}` })).json();
    expect(reloaded.status).toBe('draft');
    expect([...reloaded.jobs.map((entry: { kind: string; status: string }) => `${entry.kind}:${entry.status}`)].sort()).toEqual(['deploy:unavailable', 'generate:unavailable']);
  });

  it('answers 404 for foreign engagements and foreign campaigns', async () => {
    const app = buildApp();
    const created = (await app.inject({ method: 'POST', url: '/api/engagements/eng-1/campaigns', payload: { name: 'Wave B', vector: 'web' } })).json();
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/campaigns' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-other/campaigns', payload: { name: 'X', vector: 'web' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-1/campaigns/camp-other' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/engagements/eng-1/campaigns/${created.id}/generate` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/engagements/eng-other/campaigns/${created.id}/generate` })).statusCode).toBe(404);
  });
});

describe('W17 C2 scoped routes', () => {
  it('enforces engagement scoping and then states the unavailable provider', async () => {
    const db = buildDb();
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerCampaignRoutes(app, new CampaignService(db), new C2Service(db), IDENTITY);
    const sessions = await app.inject({ method: 'GET', url: '/api/engagements/eng-1/c2/sessions' });
    expect(sessions.statusCode).toBe(503);
    expect(sessions.json().error.code).toBe('unavailable');
    expect(sessions.json().error.message).toContain('not configured');
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/c2/sessions' })).statusCode).toBe(404);
    const command = await app.inject({ method: 'POST', url: '/api/engagements/eng-1/c2/sessions/sess-1/commands', payload: { command: 'whoami' } });
    expect(command.statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-other/c2/sessions/sess-1/commands' })).statusCode).toBe(404);
  });

  it('rejects empty session ids before any provider path', async () => {
    const service = new C2Service(buildDb());
    await expect(service.dispatchCommand('local', 'eng-1', '  ')).rejects.toBeInstanceOf(ProjectApiError);
    await expect(service.dispatchCommand('local', 'eng-1', '  ').catch(error => error.statusCode)).resolves.toBe(400);
  });
});

describe('W17 capabilities', () => {
  it('reports campaign persistence as available and c2 as provider_unavailable', async () => {
    const response = await buildCapabilitiesResponse(true, undefined, undefined, true, true, true, true, true, true, true, true, true);
    expect(response.capabilities.campaigns).toEqual({ supported: true, available: true });
    expect(response.capabilities.c2).toEqual({ supported: true, available: false, reason: 'provider_unavailable' });
    const absent = await buildCapabilitiesResponse(true, undefined, undefined, true, true, true, true, true, true, true, false, false);
    expect(absent.capabilities.campaigns).toEqual({ supported: false, available: false, reason: 'service_missing' });
    expect(absent.capabilities.c2).toEqual({ supported: false, available: false, reason: 'service_missing' });
  });
});

describe('W17 projection mapping', () => {
  it('coerces stored rows into the public DTO without leaking non-object specs', () => {
    const view = toCampaignView({ id: 'camp-1', engagementId: 'eng-1', name: 'Wave', vector: 'web', status: 'draft', version: 1, spec: 'not-an-object', jobs: [], createdAt: new Date('2026-10-02T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z') });
    expect(view.spec).toEqual({});
    expect(view.vector).toBe('web');
  });
});
