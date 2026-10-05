/** Reserve and replay campaign requests using durable scoped identities. */
import { createHash } from 'node:crypto';
import type { CampaignJob, PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';

export interface CampaignJobRequest { requestId: string; version: number }

export function parseCampaignJobRequest(body: unknown): CampaignJobRequest | undefined {
  if (body === undefined) return undefined;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ProjectApiError(400, 'Campaign job requires a JSON object');
  const raw = body as Record<string, unknown>;
  if (Object.keys(raw).length === 0) return undefined;
  if (Object.keys(raw).some(key => key !== 'requestId' && key !== 'version') ||
      typeof raw.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(raw.requestId) ||
      typeof raw.version !== 'number' || !Number.isSafeInteger(raw.version) || raw.version < 1) {
    throw new ProjectApiError(400, 'Campaign job requires requestId (8-128 identifier characters) and a positive integer version');
  }
  return { requestId: raw.requestId, version: raw.version };
}

export class CampaignJobLedger {
  public constructor(private readonly db: PrismaClient) {}

  public async reserve(campaignId: string, kind: 'generate' | 'deploy', request: CampaignJobRequest, currentVersion: number, provider = 'gophish'): Promise<{ owned: boolean; job: CampaignJob }> {
    const payloadHash = createHash('sha256').update(JSON.stringify({ kind, version: request.version, provider })).digest('hex');
    const where = { campaignId_requestId: { campaignId, requestId: request.requestId } };
    const existing = await this.db.campaignJob.findUnique({ where });
    if (existing) return this.replay(existing, payloadHash);
    if (currentVersion !== request.version) throw new ProjectApiError(409, 'Campaign version changed; reload before starting a new job');
    try {
      const job = await this.db.campaignJob.create({ data: {
        campaignId, kind, requestId: request.requestId, payloadHash, status: 'creating', provider, error: null,
        campaignVersion: request.version,
        ...(kind === 'deploy' ? { activeCampaignId: campaignId } : {}),
      } });
      return { owned: true, job };
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'P2002') throw error;
      const winner = await this.db.campaignJob.findUnique({ where });
      if (!winner) throw new ProjectApiError(409, 'Campaign has an unresolved deployment; reconcile it before retrying');
      return this.replay(winner, payloadHash);
    }
  }

  private replay(job: CampaignJob, payloadHash: string): { owned: false; job: CampaignJob } {
    if (job.payloadHash !== payloadHash) throw new ProjectApiError(409, 'Campaign requestId was already used with different input');
    return { owned: false, job };
  }
}
