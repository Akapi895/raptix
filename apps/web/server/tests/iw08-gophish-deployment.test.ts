import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { GoPhishClient } from '../src/integrations/campaigns/gophish-client.js';
import { CampaignDeploymentService } from '../src/services/campaign-deployment-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
const selection = { templateId: 1, pageId: 2, groupId: 3, smtpId: 4 };
async function provider(mode: 'valid' | 'uncertain' | 'rejected' = 'valid', recipient = 'operator@example.test') {
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const catalog = {
    templates: { id: 1, name: 'Notice', text: 'Lab only', html: '' },
    pages: { id: 2, name: 'Page', html: '<p>Lab</p>', capture_credentials: false, capture_passwords: false },
    groups: { id: 3, name: 'Recipients', targets: [{ email: recipient }] },
    smtp: { id: 4, name: 'Sink', host: 'mail-sink:1025', from_address: 'lab@example.test' },
  };
  let posts = 0;
  let name = '';
  app.get('/api/:resource/:id', async request => catalog[(request.params as { resource: keyof typeof catalog }).resource]);
  app.post('/api/groups/', async request => ({ id: 7, ...(request.body as object) }));
  app.post('/api/campaigns/', async (request, reply) => {
    posts++; name = (request.body as { name: string }).name;
    if (mode === 'rejected') return reply.code(400).send({ password: 'secret-not-public' });
    if (mode === 'uncertain') return reply.code(500).send({ password: 'secret-not-public' });
    return reply.code(201).send({ id: 11, name, status: 'In progress', timeline: [{ details: 'secret-not-public' }] });
  });
  const summary = () => ({ id: 11, name, status: 'In progress', stats: { total: 1, sent: 1, error: 0 } });
  app.get('/api/campaigns/11/summary', summary);
  app.get('/api/campaigns/summary', () => ({ campaigns: name ? [summary()] : [], total: name ? 1 : 0 }));
  const apiUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  closers.push(() => app.close());
  return { client: new GoPhishClient({ apiUrl, apiKey: 'private-key', labDeployment: true }), posts: () => posts };
}

function database(fingerprint: string) {
  const campaign = { id: 'camp-1', engagementId: 'eng-1', name: 'Lab', vector: 'phishing', status: 'prepared', version: 2,
    spec: { gophish: selection, prepared: { fingerprint } } };
  const jobs: Array<Record<string, unknown>> = [];
  const db = {
    campaign: { updateMany: async ({ where, data }: { where: { version?: number; status?: string }; data: object }) => {
      if (where.version !== undefined && where.version !== campaign.version || where.status !== undefined && where.status !== campaign.status) return { count: 0 };
      Object.assign(campaign, data); return { count: 1 };
    } },
    campaignJob: {
      findUnique: async ({ where }: { where: { id?: string; campaignId_requestId?: { campaignId: string; requestId: string } } }) => jobs.find(job => where.id ? job.id === where.id : job.campaignId === where.campaignId_requestId?.campaignId && job.requestId === where.campaignId_requestId?.requestId) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => jobs.find(job => job.id === where.id),
      findFirst: async ({ where }: { where: { id: string; campaignId: string; campaign: { engagementId: string } } }) =>
        where.campaign.engagementId === campaign.engagementId ? jobs.find(job => job.id === where.id && job.campaignId === where.campaignId) ?? null : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (jobs.some(job => job.requestId === data.requestId || data.activeCampaignId && job.activeCampaignId === data.activeCampaignId)) throw Object.assign(new Error('conflict'), { code: 'P2002' });
        const job = { providerId: null, ...data, id: `job-${jobs.length + 1}`, createdAt: new Date() }; jobs.push(job); return job;
      },
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(jobs.find(job => job.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: { id: string; status: { in: string[] } }; data: object }) => {
        const job = jobs.find(job => job.id === where.id && where.status.in.includes(job.status as string));
        if (!job) return { count: 0 }; Object.assign(job, data); return { count: 1 };
      },
    },
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation(db),
  };
  return { db: db as never, campaign: campaign as never, jobs };
}

describe('IW-08 GoPhish lab dispatch and reconciliation', () => {
  it('records accepted submission and retries without posting another campaign', async () => {
    const native = await provider();
    const store = database((await native.client.prepare(selection)).fingerprint);
    const service = new CampaignDeploymentService(store.db, native.client);
    const request = { requestId: 'deploy-request', version: 2 };
    const first = await service.deploy(store.campaign, 'http://gophish:8080', request);
    const retry = await service.deploy(store.campaign, 'http://gophish:8080', request);
    expect(first).toMatchObject({ status: 'submitted', providerId: '11', providerStatus: 'In progress', activeCampaignId: null });
    expect(retry.id).toBe(first.id);
    expect(native.posts()).toBe(1);
  });

  it('projects native SMTP acceptance counts without claiming inbox delivery', async () => {
    const native = await provider();
    const store = database((await native.client.prepare(selection)).fingerprint);
    const service = new CampaignDeploymentService(store.db, native.client);
    const job = await service.deploy(store.campaign, 'http://gophish:8080', { requestId: 'deploy-request', version: 2 });
    const refreshed = await service.reconcile('eng-1', 'camp-1', job.id);
    expect(refreshed).toMatchObject({ status: 'emails_sent', summary: { total: 1, sent: 1, errors: 0 } });
    expect(JSON.stringify(refreshed)).not.toContain('secret-not-public');
  });

  it('keeps unknown POST outcomes locked and resolves them without redispatch', async () => {
    const native = await provider('uncertain');
    const store = database((await native.client.prepare(selection)).fingerprint);
    const service = new CampaignDeploymentService(store.db, native.client);
    const job = await service.deploy(store.campaign, 'http://gophish:8080', { requestId: 'deploy-request', version: 2 });
    expect(job).toMatchObject({ status: 'uncertain', activeCampaignId: 'camp-1' });
    await expect(service.deploy(store.campaign, 'http://gophish:8080', { requestId: 'another-request', version: 2 })).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.reconcile('eng-1', 'camp-1', job.id)).providerId).toBe('11');
    expect(native.posts()).toBe(1);
  });

  it('records definitive rejection without leaking the provider body', async () => {
    const native = await provider('rejected');
    const store = database((await native.client.prepare(selection)).fingerprint);
    const job = await new CampaignDeploymentService(store.db, native.client).deploy(store.campaign, 'http://gophish:8080', { requestId: 'deploy-request', version: 2 });
    expect(job).toMatchObject({ status: 'failed', activeCampaignId: null });
    expect(job.error).not.toContain('secret-not-public');
  });

  it('refuses non-lab recipients before posting a campaign', async () => {
    const native = await provider('valid', 'employee@production.invalid');
    await expect(native.client.deployLab(selection, (await native.client.prepare(selection)).fingerprint, 'lab-job', 'http://gophish:8080')).rejects.toThrow(/test recipients/);
    expect(native.posts()).toBe(0);
  });

  it('answers 404 for a foreign engagement during reconciliation', async () => {
    const native = await provider();
    const store = database((await native.client.prepare(selection)).fingerprint);
    const service = new CampaignDeploymentService(store.db, native.client);
    const job = await service.deploy(store.campaign, 'http://gophish:8080', { requestId: 'deploy-request', version: 2 });
    await expect(service.reconcile('foreign', 'camp-1', job.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
