import { describe, expect, it } from 'vitest';
import { CampaignJobLedger, parseCampaignJobRequest } from '../src/services/campaign-job-ledger.js';

function database() {
  const jobs: Array<Record<string, unknown>> = [];
  let sequence = 0;
  return {
    jobs,
    campaignJob: {
      findUnique: async ({ where }: { where: { campaignId_requestId: { campaignId: string; requestId: string } } }) =>
        jobs.find(job => job.campaignId === where.campaignId_requestId.campaignId && job.requestId === where.campaignId_requestId.requestId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (jobs.some(job => job.campaignId === data.campaignId && job.requestId === data.requestId)) {
          throw Object.assign(new Error('request already exists'), { code: 'P2002' });
        }
        const job = { ...data, id: `job-${++sequence}`, createdAt: new Date() };
        jobs.push(job);
        return job;
      },
    },
  };
}

describe('IW-08 durable campaign request identity', () => {
  it('replays one durable job when the same request is retried', async () => {
    const db = database();
    const ledger = new CampaignJobLedger(db as never);
    const first = await ledger.reserve('campaign-1', 'generate', { requestId: 'request-123', version: 1 }, 1);
    const retry = await ledger.reserve('campaign-1', 'generate', { requestId: 'request-123', version: 1 }, 2);
    expect(first.owned).toBe(true);
    expect(retry).toMatchObject({ owned: false, job: { id: first.job.id } });
    expect(db.jobs).toHaveLength(1);
  });

  it('rejects reuse of a request ID for a different operation', async () => {
    const ledger = new CampaignJobLedger(database() as never);
    await ledger.reserve('campaign-1', 'generate', { requestId: 'request-123', version: 1 }, 1);
    await expect(ledger.reserve('campaign-1', 'deploy', { requestId: 'request-123', version: 1 }, 1)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a stale version for a new request before persistence', async () => {
    const db = database();
    await expect(new CampaignJobLedger(db as never).reserve('campaign-1', 'generate', { requestId: 'request-123', version: 1 }, 2)).rejects.toMatchObject({ statusCode: 409 });
    expect(db.jobs).toHaveLength(0);
  });

  it('separates the same request ID across campaigns', async () => {
    const db = database();
    const ledger = new CampaignJobLedger(db as never);
    const first = await ledger.reserve('campaign-1', 'generate', { requestId: 'request-123', version: 1 }, 1);
    const second = await ledger.reserve('campaign-2', 'generate', { requestId: 'request-123', version: 1 }, 1);
    expect(first.job.id).not.toBe(second.job.id);
  });

  it('allows concurrent retries to reserve only one job', async () => {
    const db = database();
    const ledger = new CampaignJobLedger(db as never);
    const reservations = await Promise.all(Array.from({ length: 8 }, () => ledger.reserve('campaign-1', 'generate', { requestId: 'request-123', version: 1 }, 1)));
    expect(reservations.filter(reservation => reservation.owned)).toHaveLength(1);
    expect(new Set(reservations.map(reservation => reservation.job.id)).size).toBe(1);
  });

  it.each([null, [], { requestId: 'short', version: 1 }, { requestId: 'request-123', version: 0 }, { requestId: 'request-123', version: 1, providerUrl: 'https://untrusted.invalid' }])('rejects malformed or unknown request fields %j', body => {
    expect(() => parseCampaignJobRequest(body)).toThrow(/Campaign job/);
  });
});
