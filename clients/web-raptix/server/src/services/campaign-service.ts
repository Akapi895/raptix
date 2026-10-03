import type { Campaign, PrismaClient } from '../generated/prisma/client.js';
import type { CampaignJobView, CampaignVector, CampaignView, CampaignsView, CampaignProviderCapabilities } from '@raptix/web-contracts';
import { ProjectApiError } from './projects-service.js';
import { GoPhishError, type GoPhishClient, type GoPhishAssets, type GoPhishManifest } from '../integrations/campaigns/gophish-client.js';
import { CampaignJobLedger, parseCampaignJobRequest, type CampaignJobRequest } from './campaign-job-ledger.js';
import { CampaignDeploymentService } from './campaign-deployment-service.js';
import type { EvilginxClient } from '../integrations/campaigns/evilginx-client.js';
import { EvilginxCampaignService } from './evilginx-campaign-service.js';

/**
 * Scoped campaign drafts and GoPhish asset preparation. A prepared manifest
 * is not delivery; providers without a dispatch path remain unavailable.
 */

export const CAMPAIGN_VECTORS = ['phishing', 'web', 'mobile'] as const;
const NAME_MAX = 120;
const SCENARIO_MAX = 200;
const CAMPAIGN_PAGE = 100;
const JOBS_PER_CAMPAIGN = 20;
const PROVIDER_UNAVAILABLE = 'campaign provider not configured';

export class CampaignValidationError extends ProjectApiError {
  public constructor(message: string) {
    super(400, message);
  }
}

export interface CampaignDraftInput {
  name: string;
  vector: CampaignVector;
  scenario?: string;
  gophish?: GoPhishAssets;
  evilginx?: { profile: 'lab' };
}

export interface CampaignRecordShape {
  id: string;
  engagementId: string;
  name: string;
  vector: string;
  status: string;
  version: number;
  spec: unknown;
  jobs: Array<{
    id: string;
    campaignId: string;
    kind: string;
    status: string;
    provider: string | null;
    error: string | null;
    requestId?: string | null;
    providerId?: string | null;
    providerStatus?: string | null;
    summary?: unknown;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export class CampaignService {
  public constructor(private readonly db: PrismaClient, private readonly gophish?: GoPhishClient, private readonly evilginx?: EvilginxClient) {}

  public async list(userId: string, engagementId: string): Promise<CampaignsView> {
    const engagement = await this.findEngagement(userId, engagementId);
    const rows = await this.db.campaign.findMany({
      where: { engagementId: engagement.id },
      orderBy: { createdAt: 'desc' },
      take: CAMPAIGN_PAGE + 1,
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: JOBS_PER_CAMPAIGN } },
    });
    const truncated = rows.length > CAMPAIGN_PAGE;
    return {
      engagementId: engagement.id,
      campaigns: rows.slice(0, CAMPAIGN_PAGE).map(row => toCampaignView(row as unknown as CampaignRecordShape)),
      truncated,
    };
  }

  public async capabilities(userId: string, engagementId: string): Promise<CampaignProviderCapabilities> {
    const engagement = await this.findEngagement(userId, engagementId);
    return { engagementId: engagement.id, source: 'configuration', draftPersistence: true, providers: [
      { provider: 'gophish', generateConfigured: this.gophish !== undefined, deployConfigured: this.gophish?.canDeploy === true, deploymentScope: 'isolated-lab' },
      { provider: 'evilginx2', generateConfigured: this.evilginx !== undefined, deployConfigured: this.evilginx !== undefined, deploymentScope: 'isolated-lab' },
    ] };
  }

  public async get(userId: string, engagementId: string, campaignId: string): Promise<CampaignView> {
    const engagement = await this.findEngagement(userId, engagementId);
    const row = await this.db.campaign.findFirst({
      where: { id: campaignId, engagementId: engagement.id },
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: JOBS_PER_CAMPAIGN } },
    });
    if (!row) throw new ProjectApiError(404, 'Campaign not found');
    return toCampaignView(row as unknown as CampaignRecordShape);
  }

  public async create(userId: string, engagementId: string, body: unknown): Promise<CampaignView> {
    const engagement = await this.findEngagement(userId, engagementId);
    const input = parseDraftInput(body);
    try {
      const row = await this.db.campaign.create({
        data: {
          engagementId: engagement.id,
          name: input.name,
          vector: input.vector,
          status: 'draft',
          version: 1,
          spec: { scenario: input.scenario ?? null, ...(input.gophish ? { gophish: { ...input.gophish } } : {}), ...(input.evilginx ? { evilginx: { ...input.evilginx } } : {}) },
        },
        include: { jobs: { orderBy: { createdAt: 'desc' }, take: JOBS_PER_CAMPAIGN } },
      });
      return toCampaignView(row as unknown as CampaignRecordShape);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'P2002') {
        throw new ProjectApiError(409, `A campaign named "${input.name}" already exists in this engagement`);
      }
      throw error;
    }
  }

  public async runJob(userId: string, engagementId: string, campaignId: string, kind: 'generate' | 'deploy', body?: unknown): Promise<CampaignJobView> {
    const engagement = await this.findEngagement(userId, engagementId);
    const campaign = await this.db.campaign.findFirst({ where: { id: campaignId, engagementId: engagement.id } });
    if (!campaign) throw new ProjectApiError(404, 'Campaign not found');
    const input = parseCampaignJobRequest(body);
    if (isPlainSpec(campaign.spec) && campaign.spec.evilginx !== undefined) {
      if (this.evilginx) {
        if (!engagement.authorizationConfirmed || engagement.targetValue.replace(/\/$/, '') !== 'https://login.origin.test') throw new ProjectApiError(403, 'Evilginx operations require the authorized synthetic lab origin');
        if (!input) throw new CampaignValidationError('Evilginx operations require requestId and version');
        return toJobView(await new EvilginxCampaignService(this.db, this.evilginx).run(campaign, kind, input));
      }
      return toJobView(await this.db.campaignJob.create({ data: { campaignId, kind, status: 'unavailable', provider: null, error: 'evilginx lab bridge not configured' } }));
    }
    if (kind === 'deploy' && this.gophish?.canDeploy && campaign.vector === 'phishing') {
      if (!engagement.authorizationConfirmed) throw new ProjectApiError(403, 'Campaign deployment requires confirmed authorization');
      if (!input) throw new CampaignValidationError('Deployment requires requestId and version');
      return toJobView(await new CampaignDeploymentService(this.db, this.gophish).deploy(campaign, engagement.targetValue, input));
    }
    if (kind === 'generate' && campaign.vector === 'phishing' && this.gophish) {
      if (!engagement.authorizationConfirmed) throw new ProjectApiError(403, 'Campaign preparation requires confirmed authorization');
      if (this.gophish.canDeploy && await this.db.campaignJob.findFirst({ where: { activeCampaignId: campaign.id } })) {
        throw new ProjectApiError(409, 'Reconcile the unresolved deployment before generating another bundle');
      }
      return this.prepareGoPhish(campaign, input, this.gophish);
    }
    const job = await this.db.campaignJob.create({
      data: { campaignId: campaign.id, kind, status: 'unavailable', provider: null, error: PROVIDER_UNAVAILABLE },
    });
    return toJobView(job);
  }

  private async prepareGoPhish(campaign: Campaign, input: CampaignJobRequest | undefined, provider: GoPhishClient): Promise<CampaignJobView> {
      const campaignId = campaign.id;
      const kind = 'generate' as const;
      const spec = isPlainSpec(campaign.spec) ? campaign.spec : {};
      const assets = parseGoPhishAssets(spec.gophish);
      const reservation = input ? await new CampaignJobLedger(this.db).reserve(campaignId, kind, input, campaign.version) : undefined;
      if (reservation && !reservation.owned) return toJobView(reservation.job);
      let prepared: GoPhishManifest;
      try {
        prepared = await provider.prepare(assets);
      } catch (error) {
        if (!(error instanceof GoPhishError)) throw error;
        const failure = { status: 'failed', error: error.message };
        return toJobView(reservation
          ? await this.db.campaignJob.update({ where: { id: reservation.job.id }, data: failure })
          : await this.db.campaignJob.create({ data: { campaignId, kind, provider: 'gophish', ...failure } }));
      }
      const job = await this.db.$transaction(async transaction => {
        const updated = await transaction.campaign.updateMany({
          where: { id: campaignId, engagementId: campaign.engagementId, version: campaign.version },
          data: { status: 'prepared', version: { increment: 1 }, spec: {
            scenario: typeof spec.scenario === 'string' ? spec.scenario : null, gophish: { ...assets }, prepared: { ...prepared, version: campaign.version + 1 },
          } },
        });
        if (updated.count !== 1) throw new ProjectApiError(409, 'Campaign changed during preparation; reload before retrying');
        return reservation
          ? transaction.campaignJob.update({ where: { id: reservation.job.id }, data: { status: 'succeeded', error: null } })
          : transaction.campaignJob.create({ data: { campaignId, kind, status: 'succeeded', provider: 'gophish', error: null } });
      }).catch(async (error: unknown) => {
        if (reservation && error instanceof ProjectApiError && error.statusCode === 409) {
          await this.db.campaignJob.update({ where: { id: reservation.job.id }, data: { status: 'failed', error: error.message } });
        }
        throw error;
      });
      return toJobView(job);
  }

  private async findEngagement(userId: string, engagementId: string) {
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!engagement) throw new ProjectApiError(404, 'Project not found');
    return engagement;
  }

  public async reconcile(userId: string, engagementId: string, campaignId: string, jobId: string): Promise<CampaignJobView> {
    const engagement = await this.findEngagement(userId, engagementId);
    const owned = await this.db.campaignJob.findFirst({ where: { id: jobId, campaignId, campaign: { engagementId: engagement.id } } });
    if (!owned) throw new ProjectApiError(404, 'Campaign job not found');
    if (owned.provider === 'evilginx2') {
      if (!this.evilginx) throw new ProjectApiError(503, 'Evilginx lab bridge not configured');
      return toJobView(await new EvilginxCampaignService(this.db, this.evilginx).reconcile(engagement.id, campaignId, jobId));
    }
    if (!this.gophish) throw new ProjectApiError(503, 'GoPhish provider not configured');
    return toJobView(await new CampaignDeploymentService(this.db, this.gophish).reconcile(engagement.id, campaignId, jobId));
  }
}

function parseDraftInput(body: unknown): CampaignDraftInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CampaignValidationError('Campaign draft requires a JSON object body');
  }
  const raw = body as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name.length < 1 || name.length > NAME_MAX) {
    throw new CampaignValidationError(`name must be a non-empty string of at most ${NAME_MAX} characters`);
  }
  if (typeof raw.vector !== 'string' || !(CAMPAIGN_VECTORS as readonly string[]).includes(raw.vector)) {
    throw new CampaignValidationError(`vector must be one of ${CAMPAIGN_VECTORS.join(', ')}`);
  }
  if (raw.scenario !== undefined && (typeof raw.scenario !== 'string' || raw.scenario.length > SCENARIO_MAX)) {
    throw new CampaignValidationError(`scenario must be a string of at most ${SCENARIO_MAX} characters`);
  }
  const scenario = raw.scenario === undefined ? undefined : (raw.scenario as string);
  if (raw.gophish !== undefined && raw.vector !== 'phishing') throw new CampaignValidationError('gophish assets require the phishing vector');
  if (raw.evilginx !== undefined && (raw.vector !== 'phishing' || raw.gophish !== undefined || !isPlainSpec(raw.evilginx) || raw.evilginx.profile !== 'lab' || Object.keys(raw.evilginx).length !== 1)) {
    throw new CampaignValidationError('evilginx requires the phishing vector and the synthetic lab profile, without GoPhish assets');
  }
  return { name, vector: raw.vector as CampaignVector, scenario,
    ...(raw.gophish === undefined ? {} : { gophish: parseGoPhishAssets(raw.gophish) }),
    ...(raw.evilginx === undefined ? {} : { evilginx: { profile: 'lab' } }) };
}

function parseGoPhishAssets(value: unknown): GoPhishAssets {
  if (!isPlainSpec(value)) throw new CampaignValidationError('gophish requires templateId, pageId, groupId and smtpId');
  const { templateId, pageId, groupId, smtpId } = value;
  if (![templateId, pageId, groupId, smtpId].every(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) {
    throw new CampaignValidationError('gophish asset IDs must be positive safe integers');
  }
  return { templateId, pageId, groupId, smtpId } as GoPhishAssets;
}

export function toCampaignView(row: CampaignRecordShape): CampaignView {
  return {
    id: row.id,
    engagementId: row.engagementId,
    name: row.name,
    vector: (CAMPAIGN_VECTORS as readonly string[]).includes(row.vector) ? (row.vector as CampaignVector) : 'phishing',
    status: row.status,
    version: row.version,
    spec: isPlainSpec(row.spec) ? row.spec : {},
    jobs: row.jobs.map(job => toJobView(job)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toJobView(job: { id: string; campaignId: string; kind: string; status: string; provider: string | null; error: string | null; requestId?: string | null; providerId?: string | null; providerStatus?: string | null; summary?: unknown; createdAt: Date }): CampaignJobView {
  const summary = isPlainSpec(job.summary) && ['total', 'sent', 'errors'].every(key => {
    const count = (job.summary as Record<string, unknown>)[key]; return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  }) ? { total: job.summary.total as number, sent: job.summary.sent as number, errors: job.summary.errors as number } : null;
  return {
    id: job.id,
    campaignId: job.campaignId,
    kind: job.kind === 'deploy' ? 'deploy' : 'generate',
    status: job.status,
    provider: job.provider,
    error: job.error,
    requestId: job.requestId ?? null,
    providerId: job.providerId ?? null,
    providerStatus: job.providerStatus ?? null,
    summary,
    createdAt: job.createdAt.toISOString(),
  };
}

function isPlainSpec(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
