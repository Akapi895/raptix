import {
  isWebShellAcquisitionCreateInput,
  isWebShellProfile,
  type WebShellAcquisitionCreateInput,
  type WebShellAcquisitionState,
  type WebShellAcquisitionView,
  type WebShellProfile,
} from '@raptix/web-contracts';
import type { Prisma, PrismaClient, WebShellAcquisition } from '../generated/prisma/client.js';
import { requireEngagementAccess, isSingleOperator } from '../auth/membership-policy.js';
import { ProjectApiError } from './projects-service.js';
import { assertEngagementOpen } from './closure-service.js';
import { sandboxTokenFor, sandboxUrlFor } from './runtime/sandbox-routing.js';
import type { ScopeService } from './scope-service.js';
import type { GovernanceService } from './governance-service.js';
import {
  type RuntimeSandboxRef,
  type RuntimeWebShellClient,
} from '../integrations/webshell/runtime-webshell-client.js';
import {
  writeWebShellAcquisitionArtifact,
  type WebShellAcquisitionProbe,
} from './webshell-artifact.js';
import type { ProjectFiles } from './project-files.js';

const MAX_LIST = 50;
const MAX_ATTEMPTS = 2;
const ERROR_LIMIT = 2048;

type ScopeGate = Pick<ScopeService, 'latestApproved'>;
type GovernanceGate = Pick<GovernanceService, 'assertNoActiveStop'>;

export interface WebShellAcquisitionServiceOptions {
  readonly db: PrismaClient;
  readonly runtime: RuntimeWebShellClient;
  readonly scope: ScopeGate;
  readonly governance: GovernanceGate;
  readonly sandboxKey: string;
  readonly perProjectSandbox: boolean;
  readonly projectFiles?: ProjectFiles;
}

function bounded(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function toView(row: WebShellAcquisition): WebShellAcquisitionView {
  return {
    id: row.id,
    engagementId: row.engagementId,
    findingId: row.findingId,
    requestId: row.requestId,
    mode: row.mode as WebShellAcquisitionView['mode'],
    state: row.state as WebShellAcquisitionState,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    pocSha256: row.pocSha256,
    specSha256: row.specSha256,
    profile: row.profile === null ? null : row.profile as unknown as WebShellProfile,
    connectionId: row.connectionId,
    error: row.error,
    artifactPath: row.artifactPath,
    artifactSha256: row.artifactSha256,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUnique(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export class WebShellAcquisitionService {
  public constructor(private readonly options: WebShellAcquisitionServiceOptions) {}

  private async access(actorId: string, engagementId: string, minRole: 'viewer' | 'operator'): Promise<void> {
    await requireEngagementAccess({ db: this.options.db, actorId, multiUser: true }, engagementId, minRole);
  }

  private requireDirectAccess(): void {
    if (!isSingleOperator()) {
      throw new ProjectApiError(403, 'WebShell acquisition requires single-operator mode (webshell_direct_access_requires_single_operator).');
    }
  }

  private async assertCanMutate(actorId: string, engagementId: string): Promise<void> {
    await this.access(actorId, engagementId, 'operator');
    this.requireDirectAccess();
    await assertEngagementOpen(this.options.db, engagementId);
  }

  private async sandboxFor(engagementId: string): Promise<RuntimeSandboxRef> {
    if (!this.options.perProjectSandbox) throw new ProjectApiError(409, 'WebShell acquisition requires a project sandbox.');
    const engagement = await this.options.db.engagement.findFirst({ where: { id: engagementId }, select: { workspaceSlug: true } });
    if (engagement === null) throw new ProjectApiError(404, 'Project not found');
    return { url: sandboxUrlFor(engagement.workspaceSlug), token: sandboxTokenFor(this.options.sandboxKey, engagement.workspaceSlug) };
  }

  public async list(actorId: string, engagementId: string): Promise<{ engagementId: string; acquisitions: WebShellAcquisitionView[] }> {
    await this.access(actorId, engagementId, 'viewer');
    const rows = await this.options.db.webShellAcquisition.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'desc' },
      take: MAX_LIST,
    });
    return { engagementId, acquisitions: rows.map(toView) };
  }

  public async get(actorId: string, engagementId: string, acquisitionId: string): Promise<WebShellAcquisitionView> {
    await this.access(actorId, engagementId, 'viewer');
    const row = await this.options.db.webShellAcquisition.findFirst({ where: { id: acquisitionId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'WebShell acquisition not found');
    return toView(row);
  }

  public async create(actorId: string, engagementId: string, body: unknown): Promise<WebShellAcquisitionView> {
    if (!isWebShellAcquisitionCreateInput(body)) throw new ProjectApiError(400, 'The WebShell acquisition input is invalid.');
    const input: WebShellAcquisitionCreateInput = body;
    await this.assertCanMutate(actorId, engagementId);
    const sandbox = await this.sandboxFor(engagementId);

    let row: WebShellAcquisition;
    try {
      row = await this.options.db.webShellAcquisition.create({
        data: {
          engagementId,
          findingId: input.findingId,
          requestId: input.requestId,
          mode: input.mode ?? 'derive',
          state: 'running',
          attempt: 1,
          maxAttempts: MAX_ATTEMPTS,
          actorId,
        },
      });
    } catch (error) {
      if (!isUnique(error)) throw error;
      const existing = await this.options.db.webShellAcquisition.findFirst({ where: { engagementId, requestId: input.requestId } });
      if (existing !== null) return toView(existing);
      throw new ProjectApiError(409, 'The acquisition could not be created.');
    }

    return this.runAcquisition(row, sandbox, engagementId);
  }

  public async retry(actorId: string, engagementId: string, acquisitionId: string): Promise<WebShellAcquisitionView> {
    await this.assertCanMutate(actorId, engagementId);
    const row = await this.options.db.webShellAcquisition.findFirst({ where: { id: acquisitionId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'WebShell acquisition not found');
    if (row.state === 'succeeded' || row.state === 'cancelled') throw new ProjectApiError(409, `The acquisition is ${row.state} and cannot be retried.`);
    if (row.attempt >= row.maxAttempts) throw new ProjectApiError(409, 'The acquisition reached its maximum attempts.');
    const sandbox = await this.sandboxFor(engagementId);
    const updated = await this.options.db.webShellAcquisition.update({
      where: { id: acquisitionId },
      data: { state: 'running', attempt: { increment: 1 }, error: null },
    });
    return this.runAcquisition(updated, sandbox, engagementId);
  }

  private async runAcquisition(row: WebShellAcquisition, sandbox: RuntimeSandboxRef, engagementId: string): Promise<WebShellAcquisitionView> {
    let profile: WebShellProfile | undefined;
    let pocSha256: string | null = null;
    let specSha256: string | null = null;
    let mode = row.mode;

    try {
      const deriveResult = await this.options.runtime.derive(sandbox, row.findingId, row.id);
      pocSha256 = deriveResult.pocSha256 ?? null;
      specSha256 = deriveResult.specSha256 ?? null;

      if (deriveResult.status === 'derived' && deriveResult.profile !== undefined && isWebShellProfile(deriveResult.profile)) {
        profile = deriveResult.profile;
        mode = 'derive';
      } else if (deriveResult.status === 'refused') {
        return toView(await this.options.db.webShellAcquisition.update({
          where: { id: row.id },
          data: { state: 'refused', error: bounded(deriveResult.reason ?? 'derive_refused', ERROR_LIMIT), pocSha256, specSha256 },
        }));
      } else if (deriveResult.status === 'needs_refinement') {
        const refineResult = await this.options.runtime.refine(sandbox, {
          findingId: row.findingId,
          acquisitionId: row.id,
          sealedPoc: {},
          findingMetadata: { finding_id: row.findingId },
          allowedTargets: await this.allowedTargets(engagementId),
          failure: deriveResult.reason,
        });
        if (refineResult.status === 'refined' && refineResult.profile !== undefined && isWebShellProfile(refineResult.profile)) {
          profile = refineResult.profile;
          mode = 'refine';
        } else {
          return toView(await this.options.db.webShellAcquisition.update({
            where: { id: row.id },
            data: { state: refineResult.status === 'refused' ? 'refused' : 'failed', error: bounded(refineResult.reason ?? 'refine_failed', ERROR_LIMIT), mode, pocSha256, specSha256 },
          }));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? bounded(error.message, ERROR_LIMIT) : 'acquisition_runtime_error';
      return toView(await this.options.db.webShellAcquisition.update({
        where: { id: row.id },
        data: { state: 'failed', error: message, pocSha256, specSha256 },
      }));
    }

    if (profile === undefined) {
      return toView(await this.options.db.webShellAcquisition.update({
        where: { id: row.id },
        data: { state: 'failed', error: 'no_profile_derived', pocSha256, specSha256 },
      }));
    }

    let probeResult: WebShellAcquisitionProbe | null = null;
    try {
      const probed = await this.options.runtime.probe(sandbox, profile, `acq-${row.id}`);
      probeResult = probed;
      if (probed.state !== 'reachable') {
        return toView(await this.options.db.webShellAcquisition.update({
          where: { id: row.id },
          data: { state: 'failed', error: `probe_${probed.state}`, profile: profile as unknown as Prisma.InputJsonValue, mode, pocSha256, specSha256 },
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? bounded(error.message, ERROR_LIMIT) : 'probe_failed';
      return toView(await this.options.db.webShellAcquisition.update({
        where: { id: row.id },
        data: { state: 'failed', error: message, profile: profile as unknown as Prisma.InputJsonValue, mode, pocSha256, specSha256 },
      }));
    }

    const key = { engagementId, provider: profile.provider, endpoint: profile.endpoint, commandParameter: profile.command_parameter };
    let connectionId: string;
    const existing = await this.options.db.webShellConnection.findUnique({ where: { engagementId_provider_endpoint_commandParameter: key } });
    if (existing !== null) {
      connectionId = existing.id;
      await this.options.db.webShellConnection.update({
        where: { id: existing.id },
        data: { state: 'reachable', lastProbeAt: new Date(), concurrencyVersion: { increment: 1 } },
      });
    } else {
      const created = await this.options.db.webShellConnection.create({
        data: {
          engagementId,
          provider: profile.provider,
          name: `${row.findingId} WebShell`,
          target: profile.target,
          endpoint: profile.endpoint,
          method: profile.method,
          contentType: profile.content_type,
          commandParameter: profile.command_parameter,
          ...(profile.headers ? { headers: profile.headers } : {}),
          probeCommand: profile.probe_command,
          probePattern: profile.probe_pattern,
          ...(profile.expected_user ? { expectedUser: profile.expected_user } : {}),
          state: 'reachable',
          source: 'poc_acquisition',
          createdBy: row.actorId,
          producerFindingId: row.findingId,
          producerPocSha256: pocSha256,
          producerSpecSha256: specSha256,
          producerAcquisitionId: row.id,
          lastProbeAt: new Date(),
        },
      });
      connectionId = created.id;
    }

    let artifactPath: string | null = null;
    let artifactSha256: string | null = null;
    if (this.options.projectFiles) {
      try {
        const engagement = await this.options.db.engagement.findFirst({ where: { id: engagementId }, select: { workspaceSlug: true } });
        if (engagement !== null) {
          const written = await writeWebShellAcquisitionArtifact(this.options.projectFiles, engagement.workspaceSlug, {
            acquisitionId: row.id,
            engagementId,
            findingId: row.findingId,
            mode: mode as 'derive' | 'refine',
            pocSha256,
            specSha256,
            profile,
            probe: probeResult,
            recordedAt: new Date().toISOString(),
          });
          artifactPath = written.path;
          artifactSha256 = written.sha256;
        }
      } catch {
        /* workspace artifact write is best-effort */
      }
    }

    return toView(await this.options.db.webShellAcquisition.update({
      where: { id: row.id },
      data: {
        state: 'succeeded',
        profile: profile as unknown as Prisma.InputJsonValue,
        connectionId,
        mode,
        pocSha256,
        specSha256,
        artifactPath,
        artifactSha256,
        error: null,
      },
    }));
  }

  private async allowedTargets(engagementId: string): Promise<string[]> {
    const scope = await this.options.scope.latestApproved(engagementId);
    if (scope === null) return [];
    const targets: string[] = [];
    if (typeof scope === 'object' && scope !== null && 'targets' in scope) {
      const list = (scope as { targets?: unknown }).targets;
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (typeof entry === 'string') targets.push(entry);
          else if (typeof entry === 'object' && entry !== null && 'address' in entry && typeof (entry as { address: unknown }).address === 'string') targets.push((entry as { address: string }).address);
        }
      }
    }
    return targets;
  }
}
