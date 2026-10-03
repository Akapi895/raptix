import { describe, expect, it } from 'vitest';
import type { EvilginxManifest } from '../src/integrations/campaigns/evilginx-client.js';
import { EvilginxBridgeError } from '../src/integrations/campaigns/evilginx-client.js';
import { EvilginxCampaignService } from '../src/services/evilginx-campaign-service.js';

function bridge(mode: 'valid' | 'failing' | 'already-enabled' = 'valid') {
  let calls = 0;
  let enabled = false;
  return {
    calls: () => calls,
    operate: async (_engagement: string, _campaign: string, version: number, operation: 'prepare' | 'deploy' | 'inspect'): Promise<EvilginxManifest> => {
      calls++;
      if (mode === 'failing' && operation !== 'inspect') throw new EvilginxBridgeError();
      if (operation === 'deploy') enabled = true;
      const label = 'a'.repeat(20);
      const status = enabled || mode === 'already-enabled' ? 'enabled' : 'disabled';
      return { provider: 'evilginx2', phishlet: `lab:${label}`, lureId: 0, url: `https://login.${label}.lab.test:8443/lab`,
        providerId: `lab:${label}:0`, providerStatus: status as 'enabled' | 'disabled', version, fingerprint: 'f'.repeat(64) };
    },
  };
}

function database(status = 'draft', version = 1) {
  const campaign = { id: 'camp-1', engagementId: 'eng-1', name: 'Lab', vector: 'phishing', status, version, spec: { evilginx: { profile: 'lab' } }, createdAt: new Date(), updatedAt: new Date() };
  const jobs: Array<Record<string, unknown>> = [];
  const db = {
    campaign: {
      findFirst: async ({ where }: { where: { id: string; engagementId: string } }) =>
        where.id === campaign.id && where.engagementId === campaign.engagementId ? campaign : null,
      updateMany: async ({ where, data }: { where: { id?: string; version?: number }; data: Record<string, unknown> }) => {
        if (where.id !== undefined && where.id !== campaign.id) return { count: 0 };
        if (where.version !== undefined && where.version !== campaign.version) return { count: 0 };
        Object.assign(campaign, data);
        return { count: 1 };
      },
    },
    campaignJob: {
      findUnique: async ({ where }: { where: { id?: string; campaignId_requestId?: { campaignId: string; requestId: string } } }) =>
        jobs.find(job => where.id !== undefined ? job.id === where.id : job.campaignId === where.campaignId_requestId?.campaignId && job.requestId === where.campaignId_requestId?.requestId) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => jobs.find(job => job.id === where.id),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.activeCampaignId !== undefined) return jobs.find(job => job.activeCampaignId === where.activeCampaignId) ?? null;
        const nested = where.campaign as { engagementId: string } | undefined;
        if (nested && nested.engagementId !== campaign.engagementId) return null;
        return jobs.find(job => job.id === where.id && job.campaignId === where.campaignId) ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (jobs.some(job => job.campaignId === data.campaignId && job.requestId === data.requestId)) {
          throw Object.assign(new Error('request already exists'), { code: 'P2002' });
        }
        const job = { ...data, id: `job-${jobs.length + 1}`, createdAt: new Date() };
        jobs.push(job);
        return job;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(jobs.find(job => job.id === where.id)!, data),
    },
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation(db),
  };
  return { db: db as never, campaign, jobs };
}

describe('IW-08 evilginx lab campaign service', () => {
  it('persists a prepared bundle with a version bump and replays retries without a second native call', async () => {
    const native = bridge();
    const store = database();
    const service = new EvilginxCampaignService(store.db, native as never);
    const request = { requestId: 'evil-request', version: 1 };
    const first = await service.run(store.campaign, 'generate', request);
    const retry = await service.run(store.campaign, 'generate', request);
    expect(first).toMatchObject({ status: 'succeeded', provider: 'evilginx2', providerStatus: 'disabled' });
    expect(retry.id).toBe(first.id);
    expect(native.calls()).toBe(1);
    expect(store.campaign).toMatchObject({ status: 'prepared', version: 2 });
  });

  it('refuses deployment before a prepared bundle exists', async () => {
    const store = database();
    await expect(new EvilginxCampaignService(store.db, bridge() as never).run(store.campaign, 'deploy', { requestId: 'evil-request', version: 1 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('enables the native proxy configuration and reconciles it without redispatch', async () => {
    const native = bridge();
    const store = database('prepared', 2);
    const service = new EvilginxCampaignService(store.db, native as never);
    const job = await service.run(store.campaign, 'deploy', { requestId: 'evil-request', version: 2 });
    expect(job).toMatchObject({ status: 'enabled', providerId: expect.stringMatching(/^lab:[a-f0-9]{20}:0$/) });
    const refreshed = await service.reconcile('eng-1', 'camp-1', job.id);
    expect(refreshed).toMatchObject({ status: 'enabled', error: null });
    expect(native.calls()).toBe(2);
  });

  it('marks unconfirmed bridge outcomes uncertain and blocks new requests until reconciled', async () => {
    const native = bridge('failing');
    const store = database();
    const service = new EvilginxCampaignService(store.db, native as never);
    const job = await service.run(store.campaign, 'generate', { requestId: 'evil-request', version: 1 });
    expect(job).toMatchObject({ status: 'uncertain' });
    await expect(service.run(store.campaign, 'deploy', { requestId: 'other-request', version: 1 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('records an already-enabled bundle as a failed generation without leaking native state', async () => {
    const store = database();
    const job = await new EvilginxCampaignService(store.db, bridge('already-enabled') as never).run(store.campaign, 'generate', { requestId: 'evil-request', version: 1 });
    expect(job).toMatchObject({ status: 'failed', activeCampaignId: null });
    expect(store.campaign.status).toBe('draft');
  });

  it('answers 404 for a foreign engagement during reconciliation', async () => {
    const native = bridge();
    const store = database('prepared', 2);
    const service = new EvilginxCampaignService(store.db, native as never);
    const job = await service.run(store.campaign, 'deploy', { requestId: 'evil-request', version: 2 });
    await expect(service.reconcile('foreign', 'camp-1', job.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
