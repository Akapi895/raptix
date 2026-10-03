/** Dispatch and reconcile isolated GoPhish lab campaigns without replaying mail. */
import type { Campaign, CampaignJob, PrismaClient } from '../generated/prisma/client.js';
import { GoPhishError, type GoPhishClient, type GoPhishAssets, type GoPhishOutcome } from '../integrations/campaigns/gophish-client.js';
import { CampaignJobLedger, type CampaignJobRequest } from './campaign-job-ledger.js';
import { ProjectApiError } from './projects-service.js';

export class CampaignDeploymentService {
  public constructor(private readonly db: PrismaClient, private readonly provider: GoPhishClient) {}

  public async deploy(campaign: Campaign, targetValue: string, input: CampaignJobRequest): Promise<CampaignJob> {
    const existing = await this.db.campaignJob.findUnique({ where: { campaignId_requestId: { campaignId: campaign.id, requestId: input.requestId } } });
    const ledger = new CampaignJobLedger(this.db);
    if (existing) return (await ledger.reserve(campaign.id, 'deploy', input, campaign.version)).job;
    const spec = campaign.spec as Record<string, unknown>;
    const prepared = spec.prepared as { fingerprint?: unknown } | undefined;
    if (campaign.status !== 'prepared' || typeof prepared?.fingerprint !== 'string') throw new ProjectApiError(409, 'Generate a prepared bundle before deployment');
    const reservation = await ledger.reserve(campaign.id, 'deploy', input, campaign.version);
    if (!reservation.owned) return reservation.job;
    const job = reservation.job;
    const locked = await this.db.campaign.updateMany({ where: { id: campaign.id, version: input.version, status: 'prepared' }, data: { status: 'deploying' } });
    if (locked.count !== 1) {
      await this.db.campaignJob.update({ where: { id: job.id }, data: { status: 'failed', activeCampaignId: null, error: 'Campaign changed before deployment' } });
      throw new ProjectApiError(409, 'Campaign changed before deployment');
    }
    let submission;
    try {
      submission = await this.provider.deployLab(spec.gophish as unknown as GoPhishAssets, prepared.fingerprint, `raptix-${job.id}`, targetValue);
    } catch (error) {
      if (!(error instanceof GoPhishError)) throw error;
      return this.db.$transaction(async transaction => {
        const updated = await transaction.campaignJob.updateMany({ where: { id: job.id, status: { in: ['creating', 'uncertain'] } }, data: {
          status: error.uncertain ? 'uncertain' : 'failed', activeCampaignId: error.uncertain ? campaign.id : null, error: error.message,
        } });
        if (updated.count === 1) await transaction.campaign.updateMany({ where: { id: campaign.id, version: input.version }, data: { status: error.uncertain ? 'uncertain' : 'prepared' } });
        return transaction.campaignJob.findUniqueOrThrow({ where: { id: job.id } });
      });
    }
    return this.db.$transaction(async transaction => {
      const updated = await transaction.campaignJob.updateMany({ where: { id: job.id, status: { in: ['creating', 'uncertain'] } }, data: { ...submission, status: 'submitted', activeCampaignId: null, error: null } });
      if (updated.count === 1) await transaction.campaign.updateMany({ where: { id: campaign.id, version: input.version }, data: { status: 'submitted' } });
      return transaction.campaignJob.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  public async reconcile(engagementId: string, campaignId: string, jobId: string): Promise<CampaignJob> {
    const job = await this.db.campaignJob.findFirst({ where: { id: jobId, campaignId, kind: 'deploy', provider: 'gophish', campaign: { engagementId } } });
    if (!job) throw new ProjectApiError(404, 'Campaign deployment job not found');
    if (!['creating', 'uncertain', 'submitted', 'emails_sent', 'partial_failure'].includes(job.status)) return job;
    const name = `raptix-${job.id}`;
    let outcome: GoPhishOutcome | null;
    try {
      outcome = job.providerId ? await this.provider.summary(job.providerId, name) : await this.provider.discover(name);
    } catch (error) {
      if (!(error instanceof GoPhishError)) throw error;
      return this.db.campaignJob.update({ where: { id: job.id }, data: { error: error.message } });
    }
    if (!outcome) return this.db.campaignJob.update({ where: { id: job.id }, data: {
      status: 'uncertain', error: 'GoPhish outcome has not been observed; automatic redispatch is blocked',
    } });
    const status = outcome.errors > 0 ? 'partial_failure' : outcome.total > 0 && outcome.sent === outcome.total ? 'emails_sent' : 'submitted';
    return this.db.$transaction(async transaction => {
      if (job.campaignVersion !== null) await transaction.campaign.updateMany({ where: { id: campaignId, version: job.campaignVersion }, data: { status } });
      return transaction.campaignJob.update({ where: { id: job.id }, data: {
        status, providerId: outcome.providerId, providerStatus: outcome.providerStatus, activeCampaignId: null, error: null,
        summary: { total: outcome.total, sent: outcome.sent, errors: outcome.errors },
      } });
    });
  }
}
