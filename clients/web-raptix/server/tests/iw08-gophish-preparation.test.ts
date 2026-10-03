import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerEnv } from '../src/config/env.js';
import { GoPhishClient } from '../src/integrations/campaigns/gophish-client.js';
import { CampaignService } from '../src/services/campaign-service.js';
import { C2Service } from '../src/services/c2-service.js';
import { registerCampaignRoutes } from '../src/http/routes/campaign.routes.js';
import { registerErrorHandler } from '../src/http/error-handler.js';

const assets = { templateId: 1, pageId: 2, groupId: 3, smtpId: 4 };
const resources = {
  templates: { id: 1, name: 'Lab notice', text: 'Lab link {{.URL}}', html: '', modified_date: '2026-10-03T00:00:00Z' },
  pages: { id: 2, name: 'Lab page', html: '<p>Lab only</p>', capture_credentials: false, capture_passwords: false, modified_date: '2026-10-03T00:00:00Z' },
  groups: { id: 3, name: 'Lab group', targets: [{ email: 'operator@example.test', first_name: 'Test' }], modified_date: '2026-10-03T00:00:00Z' },
  smtp: { id: 4, name: 'Mail sink', host: 'mail-sink:1025', from_address: 'lab@example.test', username: 'private-user', password: 'private-password', modified_date: '2026-10-03T00:00:00Z' },
};
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

async function provider(mode: 'valid' | 'missing' | 'malformed' | 'redirect' | 'unauthorized' | 'invalidjson' | 'oversized' | 'timeout' = 'valid', onRead: () => void = () => {}) {
  const app = Fastify({ logger: false, forceCloseConnections: true });
  let calls = 0;
  app.get('/api/:resource/:id', async (request, reply) => {
    calls++;
    onRead();
    if (request.headers.authorization !== 'Bearer private-api-key') return reply.code(401).send({ secret: 'never public' });
    if (mode === 'missing') return reply.code(404).send({ message: 'private-api-key private-password' });
    if (mode === 'malformed') return reply.send({ id: 'bad', name: 'private-api-key' });
    if (mode === 'redirect') return reply.redirect('/api/templates/1');
    if (mode === 'unauthorized') return reply.code(401).send({ password: 'private-password' });
    if (mode === 'invalidjson') return reply.type('application/json').send('invalid private-api-key JSON');
    if (mode === 'oversized') return reply.type('application/json').send('x'.repeat(600 * 1024));
    if (mode === 'timeout') await new Promise(resolve => setTimeout(resolve, 6_000));
    const { resource } = request.params as { resource: keyof typeof resources };
    return resources[resource];
  });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  closers.push(() => app.close());
  return { client: new GoPhishClient({ apiUrl: baseUrl, apiKey: 'private-api-key' }), calls: () => calls };
}

function database(authorized = true) {
  const row = { id: 'campaign-1', engagementId: 'eng-1', name: 'Lab', vector: 'phishing', status: 'draft', version: 1,
    spec: { scenario: 'lab', gophish: assets }, createdAt: new Date(), updatedAt: new Date() };
  const jobs: Array<Record<string, unknown>> = [];
  const db = {
    engagement: { findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === 'eng-1' && where.userId === 'local' ? { id: 'eng-1', authorizationConfirmed: authorized } : null },
    campaign: {
      findFirst: async ({ where }: { where: { id: string; engagementId: string } }) =>
        where.id === row.id && where.engagementId === row.engagementId ? { ...row, jobs: [...jobs] } : null,
      updateMany: async ({ where, data }: { where: { id: string; version: number }; data: { spec: typeof row.spec; status: string } }) => {
        if (where.version !== row.version) return { count: 0 };
        Object.assign(row, data, { version: row.version + 1 });
        return { count: 1 };
      },
    },
    campaignJob: { create: async ({ data }: { data: Record<string, unknown> }) => {
      const job = { ...data, id: `job-${jobs.length + 1}`, createdAt: new Date() };
      jobs.push(job);
      return job;
    } },
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation(db),
  };
  return { db: db as never, row, jobs };
}

describe('IW-08 GoPhish asset preparation', () => {
  it('reads native assets without returning recipients or SMTP credentials', async () => {
    const native = await provider();
    const manifest = await native.client.prepare(assets);
    expect(manifest.assets.map(asset => asset.id)).toEqual([1, 2, 3, 4]);
    expect(manifest.recipientCount).toBe(1);
    expect(manifest.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(manifest)).not.toMatch(/private-|operator@example.test|Lab link|Lab only/);
  });

  it('persists a prepared manifest through the scoped generate route and reload', async () => {
    const native = await provider();
    const store = database();
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerCampaignRoutes(app, new CampaignService(store.db, native.client), new C2Service(store.db), { id: 'local', mode: 'local-single-user' });
    closers.push(() => app.close());
    const generated = await app.inject({ method: 'POST', url: '/api/engagements/eng-1/campaigns/campaign-1/generate' });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({ status: 'succeeded', provider: 'gophish', error: null });
    const reload = (await app.inject('/api/engagements/eng-1/campaigns/campaign-1')).json();
    expect(reload).toMatchObject({ status: 'prepared', version: 2, spec: { prepared: { provider: 'gophish', recipientCount: 1 } } });
    expect(JSON.stringify(reload)).not.toMatch(/private-|operator@example.test/);
  });

  it('rejects foreign engagements before provider access', async () => {
    const native = await provider();
    const store = database();
    await expect(new CampaignService(store.db, native.client).runJob('local', 'foreign', 'campaign-1', 'generate')).rejects.toMatchObject({ statusCode: 404 });
    expect(native.calls()).toBe(0);
  });

  it('rejects unconfirmed authorization before provider access', async () => {
    const native = await provider();
    const store = database(false);
    await expect(new CampaignService(store.db, native.client).runJob('local', 'eng-1', 'campaign-1', 'generate')).rejects.toMatchObject({ statusCode: 403 });
    expect(native.calls()).toBe(0);
  });

  it('rejects a concurrent campaign revision without writing a successful job', async () => {
    const store = database();
    const native = await provider('valid', () => { store.row.version = 2; });
    await expect(new CampaignService(store.db, native.client).runJob('local', 'eng-1', 'campaign-1', 'generate')).rejects.toMatchObject({ statusCode: 409 });
    expect(store.jobs).toHaveLength(0);
  });

  it.each([0, -1, 1.5, '4', Number.MAX_SAFE_INTEGER + 1])('rejects invalid native asset ID %s before draft persistence', async smtpId => {
    const store = database();
    await expect(new CampaignService(store.db).create('local', 'eng-1', { name: 'Invalid selection', vector: 'phishing', gophish: { ...assets, smtpId } })).rejects.toMatchObject({ statusCode: 400 });
  });

  it.each(['missing', 'malformed', 'redirect'] as const)('records %s provider failure without changing the draft or leaking provider bodies', async mode => {
    const native = await provider(mode);
    const store = database();
    const job = await new CampaignService(store.db, native.client).runJob('local', 'eng-1', 'campaign-1', 'generate');
    expect(job.status).toBe('failed');
    expect(job.error).not.toMatch(/private-|never public/);
    expect(store.row.status).toBe('draft');
    expect(store.jobs).toHaveLength(1);
  });

  it.each(['unauthorized', 'invalidjson', 'oversized'] as const)('bounds and redacts %s native responses', async mode => {
    const native = await provider(mode);
    await expect(native.client.prepare(assets)).rejects.toThrow(/^GoPhish (?!.*private-)/);
  });

  it('records a native response timeout without mutating the campaign', async () => {
    const native = await provider('timeout');
    const store = database();
    const job = await new CampaignService(store.db, native.client).runJob('local', 'eng-1', 'campaign-1', 'generate');
    expect(job).toMatchObject({ status: 'failed', error: 'GoPhish asset request timed out' });
    expect(store.row.status).toBe('draft');
  }, 10_000);

  it('keeps deploy unavailable until a real dispatch path exists', async () => {
    const native = await provider();
    const store = database();
    const job = await new CampaignService(store.db, native.client).runJob('local', 'eng-1', 'campaign-1', 'deploy');
    expect(job.status).toBe('unavailable');
    expect(native.calls()).toBe(0);
  });

  it('rejects incomplete configuration without echoing credentials', () => {
    expect(() => loadServerEnv({ GOPHISH_API_KEY: 'private-api-key' })).toThrow(/GOPHISH_API_URL/);
    expect(() => loadServerEnv({ GOPHISH_API_URL: 'https://private-user:private-password@example.test', GOPHISH_API_KEY: 'private-api-key' })).toThrow(/GOPHISH_API_URL/);
  });

  it('accepts explicitly configured loopback lab HTTP and verified HTTPS', () => {
    expect(loadServerEnv({ GOPHISH_API_URL: 'http://127.0.0.1:3333', GOPHISH_API_KEY: 'private-api-key' }).gophish?.apiUrl).toBe('http://127.0.0.1:3333');
    expect(loadServerEnv({ GOPHISH_API_URL: 'https://gophish.example.test:3333', GOPHISH_API_KEY: 'private-api-key' }).gophish?.apiUrl).toBe('https://gophish.example.test:3333');
  });
});
