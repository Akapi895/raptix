import { createHash } from 'node:crypto';
import {
  isWebShellCommandCreateInput,
  isWebShellConnectionCreateInput,
  isWebShellProfile,
  type WebShellCommandStatus,
  type WebShellCommandView,
  type WebShellConnectionCreateInput,
  type WebShellConnectionState,
  type WebShellConnectionView,
  type WebShellProbeState,
  type WebShellProbeView,
  type WebShellProfile,
  type WebShellSource,
} from '@raptix/web-contracts';
import type { PrismaClient, WebShellCommand, WebShellConnection, WebShellProbe } from '../generated/prisma/client.js';
import { requireEngagementAccess } from '../auth/membership-policy.js';
import { isSingleOperator } from '../auth/membership-policy.js';
import { ProjectApiError } from './projects-service.js';
import { assertEngagementOpen } from './closure-service.js';
import { sandboxTokenFor, sandboxUrlFor } from './runtime/sandbox-routing.js';
import type { ScopeService } from './scope-service.js';
import type { GovernanceService } from './governance-service.js';
import {
  RuntimeWebShellError,
  RuntimeWebShellUnavailableError,
  type RuntimeSandboxRef,
  type RuntimeWebShellClient,
} from '../integrations/webshell/runtime-webshell-client.js';

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const OUTPUT_LIMIT = 196608;
const ERROR_LIMIT = 2048;
const MAX_LIST = 100;

type ConnectionWithProbes = WebShellConnection & { probes: WebShellProbe[] };

type ScopeGate = Pick<ScopeService, 'latestApproved' | 'roeWindowAllows' | 'targetInScope'>;
type GovernanceGate = Pick<GovernanceService, 'assertNoActiveStop'>;

export interface WebShellServiceOptions {
  readonly db: PrismaClient;
  readonly runtime: RuntimeWebShellClient;
  readonly scope: ScopeGate;
  readonly governance: GovernanceGate;
  readonly sandboxKey: string;
  readonly perProjectSandbox: boolean;
}

function bounded(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function optionalText(value: unknown, limit: number): string | null {
  return typeof value === 'string' ? bounded(value, limit) : null;
}

function displayName(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProjectApiError(400, 'The connection name must be 1-128 printable characters.');
  }
  return value;
}

function requestIdOf(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectApiError(400, 'A requestId is required.');
  }
  const keys = Object.keys(value);
  const id = (value as { requestId?: unknown }).requestId;
  if (keys.length !== 1 || keys[0] !== 'requestId' || typeof id !== 'string' || !REQUEST_ID.test(id)) {
    throw new ProjectApiError(400, 'The requestId is invalid or the body has unexpected fields.');
  }
  return id;
}

function profileOf(row: WebShellConnection): WebShellProfile {
  const profile: WebShellProfile = {
    provider: row.provider as WebShellProfile['provider'],
    target: row.target,
    endpoint: row.endpoint,
    method: row.method as WebShellProfile['method'],
    content_type: row.contentType as WebShellProfile['content_type'],
    command_parameter: row.commandParameter,
    ...(row.headers === null ? {} : { headers: row.headers as Record<string, string> }),
    probe_command: row.probeCommand,
    probe_pattern: row.probePattern,
    ...(row.expectedUser === null ? {} : { expected_user: row.expectedUser }),
  };
  if (!isWebShellProfile(profile)) throw new ProjectApiError(503, 'The stored WebShell profile is invalid.');
  return profile;
}

function stableHeaders(value: Record<string, string> | undefined): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))));
}

function sameProfile(row: WebShellConnection, profile: WebShellProfile): boolean {
  return row.provider === profile.provider && row.target === profile.target && row.endpoint === profile.endpoint
    && row.method === profile.method && row.contentType === profile.content_type
    && row.commandParameter === profile.command_parameter
    && (row.expectedUser ?? undefined) === profile.expected_user
    && row.probeCommand === profile.probe_command && row.probePattern === profile.probe_pattern
    && stableHeaders(row.headers === null ? undefined : row.headers as Record<string, string>) === stableHeaders(profile.headers);
}

function toConnectionView(row: ConnectionWithProbes): WebShellConnectionView {
  return {
    id: row.id,
    engagementId: row.engagementId,
    name: row.name,
    assetId: row.assetId,
    profile: profileOf(row),
    state: row.state as WebShellConnectionState,
    source: row.source as WebShellSource,
    createdBy: row.createdBy,
    producerFindingId: row.producerFindingId,
    producerPocSha256: row.producerPocSha256,
    producerSpecSha256: row.producerSpecSha256,
    producerAcquisitionId: row.producerAcquisitionId,
    lastProbeState: row.lastProbeId === null ? null : (row.probes[0]?.state as WebShellProbeState | undefined) ?? null,
    lastProbeAt: row.lastProbeAt?.toISOString() ?? null,
    concurrencyVersion: row.concurrencyVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProbeView(row: WebShellProbe): WebShellProbeView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    engagementId: row.engagementId,
    requestId: row.requestId,
    state: row.state as WebShellProbeState,
    httpStatus: row.httpStatus,
    matched: row.matched,
    output: row.output,
    outputTruncated: row.outputTruncated,
    error: row.error,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

function toCommandView(row: WebShellCommand): WebShellCommandView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    engagementId: row.engagementId,
    requestId: row.requestId,
    command: row.command,
    status: row.status as WebShellCommandStatus,
    httpStatus: row.httpStatus,
    exitCode: row.exitCode,
    output: row.output,
    outputTruncated: row.outputTruncated,
    error: row.error,
    actorId: row.actorId,
    runId: row.runId,
    invocationId: row.invocationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUnique(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export class WebShellService {
  public constructor(private readonly options: WebShellServiceOptions) {}

  public get runtimeConfigured(): boolean {
    return this.options.perProjectSandbox;
  }

  private async access(actorId: string, engagementId: string, minRole: 'viewer' | 'operator'): Promise<void> {
    await requireEngagementAccess({ db: this.options.db, actorId, multiUser: true }, engagementId, minRole);
  }

  private requireDirectAccess(): void {
    if (!isSingleOperator()) {
      throw new ProjectApiError(403, 'WebShell direct access requires single-operator mode (webshell_direct_access_requires_single_operator).');
    }
  }

  private async assertCanMutate(actorId: string, engagementId: string): Promise<void> {
    await this.access(actorId, engagementId, 'operator');
    this.requireDirectAccess();
    await assertEngagementOpen(this.options.db, engagementId);
  }

  private async assertExecutionAllowed(engagementId: string, target: string): Promise<void> {
    const approved = await this.options.scope.latestApproved(engagementId);
    if (approved === null) throw new ProjectApiError(403, 'WebShell requires an approved scope revision for this engagement; complete the scope review first.');
    await this.options.governance.assertNoActiveStop(engagementId, null);
    const roe = await this.options.scope.roeWindowAllows(engagementId, Date.now());
    if (!roe.ok) throw new ProjectApiError(403, roe.reason ?? 'Outside the approved ROE time windows.');
    const scope = await this.options.scope.targetInScope(engagementId, target);
    if (!scope.ok) throw new ProjectApiError(403, scope.reason ?? `Target ${target} is outside the approved effective scope.`);
  }

  private async connectionFor(engagementId: string, connectionId: string): Promise<ConnectionWithProbes> {
    const row = await this.options.db.webShellConnection.findFirst({
      where: { id: connectionId, engagementId },
      include: { probes: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (row === null) throw new ProjectApiError(404, 'WebShell connection not found');
    return row;
  }

  private async sandboxFor(engagementId: string): Promise<RuntimeSandboxRef> {
    if (!this.options.perProjectSandbox) throw new ProjectApiError(409, 'WebShell runs only in the project sandbox, and this deployment has none.');
    const engagement = await this.options.db.engagement.findFirst({ where: { id: engagementId }, select: { workspaceSlug: true } });
    if (engagement === null) throw new ProjectApiError(404, 'Project not found');
    return { url: sandboxUrlFor(engagement.workspaceSlug), token: sandboxTokenFor(this.options.sandboxKey, engagement.workspaceSlug) };
  }

  private mapRuntimeError(error: unknown): ProjectApiError {
    if (error instanceof RuntimeWebShellUnavailableError) return new ProjectApiError(503, error.message);
    if (error instanceof RuntimeWebShellError) {
      return new ProjectApiError(error.statusCode === 400 || error.statusCode === 403 || error.statusCode === 503 ? error.statusCode : 502, error.message);
    }
    return new ProjectApiError(502, 'The runtime returned an unexpected WebShell error.');
  }

  private async verifyAsset(engagementId: string, assetId: string): Promise<void> {
    const asset = await this.options.db.webAsset.findFirst({ where: { id: assetId, engagementId }, select: { id: true } });
    if (asset === null) throw new ProjectApiError(400, 'The selected asset does not belong to this engagement.');
  }

  public async list(actorId: string, engagementId: string): Promise<{ engagementId: string; connections: WebShellConnectionView[] }> {
    await this.access(actorId, engagementId, 'viewer');
    const rows = await this.options.db.webShellConnection.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'desc' },
      take: MAX_LIST,
      include: { probes: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return { engagementId, connections: rows.map(toConnectionView) };
  }

  public async get(actorId: string, engagementId: string, connectionId: string): Promise<WebShellConnectionView> {
    await this.access(actorId, engagementId, 'viewer');
    return toConnectionView(await this.connectionFor(engagementId, connectionId));
  }

  public async create(actorId: string, engagementId: string, body: unknown): Promise<WebShellConnectionView> {
    if (!isWebShellConnectionCreateInput(body)) throw new ProjectApiError(400, 'The WebShell connection input is invalid.');
    const input: WebShellConnectionCreateInput = body;
    await this.assertCanMutate(actorId, engagementId);
    await this.assertExecutionAllowed(engagementId, input.profile.target);
    if (input.assetId !== undefined) await this.verifyAsset(engagementId, input.assetId);
    const key = { engagementId, provider: input.profile.provider, endpoint: input.profile.endpoint, commandParameter: input.profile.command_parameter };
    const existing = await this.options.db.webShellConnection.findUnique({ where: { engagementId_provider_endpoint_commandParameter: key }, include: { probes: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (existing !== null) {
      if (!sameProfile(existing, input.profile)) throw new ProjectApiError(409, 'A WebShell connection already exists for this endpoint with a different profile.');
      return toConnectionView(existing);
    }
    try {
      const row = await this.options.db.webShellConnection.create({
        data: {
          engagementId,
          ...(input.assetId === undefined ? {} : { assetId: input.assetId }),
          provider: input.profile.provider,
          name: input.name,
          target: input.profile.target,
          endpoint: input.profile.endpoint,
          method: input.profile.method,
          contentType: input.profile.content_type,
          commandParameter: input.profile.command_parameter,
          ...(input.profile.headers === undefined ? {} : { headers: input.profile.headers }),
          probeCommand: input.profile.probe_command,
          probePattern: input.profile.probe_pattern,
          ...(input.profile.expected_user === undefined ? {} : { expectedUser: input.profile.expected_user }),
          state: 'unverified',
          source: 'manual',
          createdBy: actorId,
        },
        include: { probes: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      return toConnectionView(row);
    } catch (error) {
      if (!isUnique(error)) throw error;
      const winner = await this.options.db.webShellConnection.findUnique({ where: { engagementId_provider_endpoint_commandParameter: key }, include: { probes: { orderBy: { createdAt: 'desc' }, take: 1 } } });
      if (winner === null) throw new ProjectApiError(409, 'The WebShell connection could not be created.');
      if (!sameProfile(winner, input.profile)) throw new ProjectApiError(409, 'A WebShell connection already exists for this endpoint with a different profile.');
      return toConnectionView(winner);
    }
  }

  public async update(actorId: string, engagementId: string, connectionId: string, body: unknown): Promise<WebShellConnectionView> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ProjectApiError(400, 'The WebShell update body is invalid.');
    const input = body as { name?: unknown; assetId?: unknown; profile?: unknown };
    const keys = Object.keys(body);
    if (keys.length === 0 || keys.some((key) => key !== 'name' && key !== 'assetId' && key !== 'profile')) throw new ProjectApiError(400, 'The WebShell update body has unexpected fields.');
    await this.assertCanMutate(actorId, engagementId);
    await this.connectionFor(engagementId, connectionId);
    const data: {
      name?: string
      assetId?: string | null
      concurrencyVersion: { increment: number }
      provider?: WebShellProfile['provider']
      target?: string
      endpoint?: string
      method?: WebShellProfile['method']
      contentType?: WebShellProfile['content_type']
      commandParameter?: string
      headers?: Record<string, string>
      probeCommand?: string
      probePattern?: string
      expectedUser?: string | null
      state?: string
      lastProbeId?: string | null
      lastProbeAt?: Date | null
    } = { concurrencyVersion: { increment: 1 } };
    if (input.name !== undefined) data.name = displayName(input.name);
    if (input.assetId !== undefined) {
      if (input.assetId === null) data.assetId = null;
      else if (typeof input.assetId === 'string' && input.assetId.length > 0) { await this.verifyAsset(engagementId, input.assetId); data.assetId = input.assetId; }
      else throw new ProjectApiError(400, 'assetId must be a non-empty string or null.');
    }
    if (input.profile !== undefined) {
      if (!isWebShellProfile(input.profile)) throw new ProjectApiError(400, 'The replacement WebShell profile is invalid.');
      const unresolved = await this.options.db.webShellCommand.findFirst({ where: { connectionId, engagementId, status: { in: ['creating', 'uncertain'] } } });
      if (unresolved !== null) throw new ProjectApiError(409, 'The profile cannot change while an unresolved command holds this connection.');
      await this.assertExecutionAllowed(engagementId, input.profile.target);
      data.provider = input.profile.provider;
      data.target = input.profile.target;
      data.endpoint = input.profile.endpoint;
      data.method = input.profile.method;
      data.contentType = input.profile.content_type;
      data.commandParameter = input.profile.command_parameter;
      data.headers = input.profile.headers ?? {};
      data.probeCommand = input.profile.probe_command;
      data.probePattern = input.profile.probe_pattern;
      data.expectedUser = input.profile.expected_user ?? null;
      data.state = 'unverified';
      data.lastProbeId = null;
      data.lastProbeAt = null;
    }
    try {
      const row = await this.options.db.webShellConnection.update({
        where: { id: connectionId },
        data,
        include: { probes: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      return toConnectionView(row);
    } catch (error) {
      if (isUnique(error)) throw new ProjectApiError(409, 'Another WebShell connection already uses this endpoint and command parameter.');
      throw error;
    }
  }

  public async close(actorId: string, engagementId: string, connectionId: string): Promise<WebShellConnectionView> {
    await this.assertCanMutate(actorId, engagementId);
    const current = await this.connectionFor(engagementId, connectionId);
    if (current.state === 'closed') return toConnectionView(current);
    const row = await this.options.db.webShellConnection.update({
      where: { id: connectionId },
      data: { state: 'closed', concurrencyVersion: { increment: 1 } },
      include: { probes: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return toConnectionView(row);
  }
}
