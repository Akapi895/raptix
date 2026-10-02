import type { PrismaClient } from '../generated/prisma/client.js';
import type { CampaignJobView, CampaignVector, CampaignView, CampaignsView } from '@raptix/web-contracts';
import { ProjectApiError } from './projects-service.js';

/**
 * W17 vector campaigns: persistence-backed drafts plus truthful provider
 * jobs. The campaign provider is not wired in this build — no generation or
 * delivery endpoint exists anywhere — so generate/deploy attempts record a
 * durable job whose status states `unavailable` and the campaign stays in
 * draft. Nothing here can fabricate a Generated/Delivered outcome, and every
 * read is scoped to the owning engagement (foreign ids answer 404).
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
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export class CampaignService {
  public constructor(private readonly db: PrismaClient) {}

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
          spec: { scenario: input.scenario ?? null },
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

  public async runJob(userId: string, engagementId: string, campaignId: string, kind: 'generate' | 'deploy'): Promise<CampaignJobView> {
    const engagement = await this.findEngagement(userId, engagementId);
    const campaign = await this.db.campaign.findFirst({ where: { id: campaignId, engagementId: engagement.id } });
    if (!campaign) throw new ProjectApiError(404, 'Campaign not found');
    // Truthful provider outcome: the request is durably recorded as
    // unavailable; the campaign row is intentionally not mutated.
    const job = await this.db.campaignJob.create({
      data: { campaignId: campaign.id, kind, status: 'unavailable', provider: null, error: PROVIDER_UNAVAILABLE },
    });
    return toJobView(job);
  }

  private async findEngagement(userId: string, engagementId: string) {
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!engagement) throw new ProjectApiError(404, 'Project not found');
    return engagement;
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
  return { name, vector: raw.vector as CampaignVector, scenario };
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

function toJobView(job: { id: string; campaignId: string; kind: string; status: string; provider: string | null; error: string | null; createdAt: Date }): CampaignJobView {
  return {
    id: job.id,
    campaignId: job.campaignId,
    kind: job.kind === 'deploy' ? 'deploy' : 'generate',
    status: job.status,
    provider: job.provider,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
  };
}

function isPlainSpec(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
