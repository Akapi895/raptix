/** Persist scoped outcomes from idempotent synthetic evilginx2 lab operations. */
import type { Campaign, CampaignJob, PrismaClient } from '../generated/prisma/client.js';
import { EvilginxBridgeError, type EvilginxClient, type EvilginxManifest } from '../integrations/campaigns/evilginx-client.js';
import { CampaignJobLedger, type CampaignJobRequest } from './campaign-job-ledger.js';
import { ProjectApiError } from './projects-service.js';

export class EvilginxCampaignService {
  public constructor(private readonly db: PrismaClient, private readonly provider: EvilginxClient) {}

  public async run(campaign: Campaign, kind: 'generate' | 'deploy', input: CampaignJobRequest): Promise<CampaignJob> {
    const existing = await this.db.campaignJob.findUnique({ where: { campaignId_requestId: { campaignId: campaign.id, requestId: input.requestId } } });
    const ledger = new CampaignJobLedger(this.db);
    if (existing) return (await ledger.reserve(campaign.id, kind, input, campaign.version, 'evilginx2')).job;
    if (kind === 'deploy' && campaign.status !== 'prepared') throw new ProjectApiError(409, 'Generate a prepared lab bundle before deployment');
    if (await this.db.campaignJob.findFirst({ where: { activeCampaignId: campaign.id } })) throw new ProjectApiError(409, 'Reconcile the unresolved deployment first');
    const reservation = await ledger.reserve(campaign.id, kind, input, campaign.version, 'evilginx2');
    if (!reservation.owned) return reservation.job;
    const version = kind === 'generate' ? input.version + 1 : input.version;
    let manifest: EvilginxManifest;
    try {
      manifest = await this.provider.operate(campaign.engagementId, campaign.id, version, kind === 'generate' ? 'prepare' : 'deploy');
      if (kind === 'generate' && manifest.providerStatus !== 'disabled') throw new ProjectApiError(409, 'Native lab bundle is already enabled');
    } catch (error) {
      if (!(error instanceof EvilginxBridgeError) && !(error instanceof ProjectApiError)) throw error;
      return this.db.campaignJob.update({ where: { id: reservation.job.id }, data: {
        status: error instanceof EvilginxBridgeError ? 'uncertain' : 'failed', error: error.message,
        ...(error instanceof ProjectApiError ? { activeCampaignId: null } : {}),
      } });
    }
    return this.persist(campaign, reservation.job, manifest, false);
  }

  public async reconcile(engagementId: string, campaignId: string, jobId: string): Promise<CampaignJob> {
    const job = await this.db.campaignJob.findFirst({ where: { id: jobId, campaignId, provider: 'evilginx2', campaign: { engagementId } } });
    if (!job || job.campaignVersion === null) throw new ProjectApiError(404, 'Owned evilginx job not found');
    const campaign = await this.db.campaign.findFirst({ where: { id: campaignId, engagementId } });
    if (!campaign) throw new ProjectApiError(404, 'Campaign not found');
    try {
      const version = job.kind === 'generate' ? job.campaignVersion + 1 : job.campaignVersion;
      const manifest = await this.provider.operate(engagementId, campaignId, version, 'inspect');
      return this.persist(campaign, job, manifest, true);
    } catch (error) {
      if (!(error instanceof EvilginxBridgeError)) throw error;
      return this.db.campaignJob.update({ where: { id: job.id }, data: { error: error.message } });
    }
  }

  private async persist(campaign: Campaign, job: CampaignJob, manifest: EvilginxManifest, reconciliation: boolean): Promise<CampaignJob> {
    const generating = job.kind === 'generate';
    const status = generating ? 'prepared' : manifest.providerStatus;
    return this.db.$transaction(async transaction => {
      const updated = await transaction.campaign.updateMany({ where: { id: campaign.id, version: job.campaignVersion ?? -1 }, data: generating ? {
        status, version: manifest.version, spec: { evilginx: { profile: 'lab' }, prepared: { ...manifest } },
      } : { status } });
      if (updated.count === 0 && !reconciliation) throw new ProjectApiError(409, 'Campaign changed during the native operation');
      return transaction.campaignJob.update({ where: { id: job.id }, data: {
        status: generating ? 'succeeded' : manifest.providerStatus, providerId: manifest.providerId,
        providerStatus: manifest.providerStatus, error: null, activeCampaignId: null,
      } });
    });
  }
}
