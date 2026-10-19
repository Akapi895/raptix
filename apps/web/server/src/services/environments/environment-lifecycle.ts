import type { EnvironmentCommandResult } from '@raptix/web-contracts';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  ControllerRefusedError,
  type ControllerIdentity,
  type ControllerRequest,
  type ControllerRole,
  type HostControllerClient,
} from '../../integrations/environments/controller-client.js';
import { runtimeUrlFor, type ProjectEnvironmentService } from './project-environment-service.js';

export interface LifecycleConfig {
  deploymentId: string;
  runtimeImage: string;
  sandboxImage: string;
  /** The host directory that holds every project workspace; the project's slug names its subdirectory. */
  workspaceHostRoot: string;
  stopTimeoutSeconds: number;
}

export interface LifecycleOptions {
  /** Confirms the runtime answers at its endpoint. The default asks GET /ok, the same check the runtime image uses. */
  probe?: (endpoint: string) => Promise<boolean>;
  /** How long a started environment may take to become ready before this attempt rolls back. */
  readinessTimeoutMs?: number;
  pollIntervalMs?: number;
}

type Seen =
  | { kind: 'absent' }
  | { kind: 'present'; running: boolean; generation: number; health: string }
  | { kind: 'unknown' };

interface EnvironmentRow { id: string; generation: number; workspaceSlug: string }

const ROLES: readonly ControllerRole[] = ['runtime', 'sandbox'];
/** Refusals that prove nothing of this environment was created, so the slot may be released when nothing runs. */
const NOTHING_CREATED = new Set(['foreign_resource', 'generation_mismatch', 'image_missing', 'rejected_path', 'rejected_image', 'invalid_request']);

async function defaultProbe(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/ok`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Drives the host controller for one command the environment service already accepted (ADR-0092 §4.3). The slot
 * moves only on what was observed. A started environment is ready only when both containers run, their health
 * checks pass, and the runtime answers. An attempt that never gets there is rolled back, not left running.
 */
export class EnvironmentLifecycle {
  private readonly probe: (endpoint: string) => Promise<boolean>;
  private readonly readinessTimeoutMs: number;
  private readonly pollIntervalMs: number;

  public constructor(
    private readonly db: PrismaClient,
    private readonly service: ProjectEnvironmentService,
    private readonly controller: HostControllerClient,
    private readonly config: LifecycleConfig,
    options: LifecycleOptions = {},
  ) {
    this.probe = options.probe ?? defaultProbe;
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 600_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
  }

  /** Create and start both containers, wait for readiness, and report ready with the endpoint. */
  public async bringUp(engagementId: string, commandId: string, slotVersion: number): Promise<EnvironmentCommandResult> {
    const env = await this.environment(engagementId);
    const found = await this.incarnation(env);
    // Not even the first observation answered. The slot is held as uncertain, at the version the caller passed in.
    if (found === null) return this.report(env, commandId, slotVersion, 'uncertain', env.generation);
    const { generation, seen } = found;
    try {
      // A container left at an older generation is recreated at the chosen one. Only a stopped container can be.
      for (let index = 0; index < ROLES.length; index++) {
        const item = seen[index];
        if (item?.kind === 'present' && item.generation !== generation) await this.controller.call('recreate', this.request(env, ROLES[index]!, generation));
      }
      for (const role of ROLES) await this.controller.call('ensure', this.request(env, role, generation));
      for (const role of ROLES) await this.controller.call('start', { identity: this.identity(env, role, generation) });
      if (await this.awaitReady(env, generation)) return this.report(env, commandId, slotVersion, 'ready', generation);
      // Not ready in time: stop what this attempt started, then report only what is observed.
      return this.report(env, commandId, slotVersion, await this.stopAll(env, generation), generation);
    } catch (error) {
      const seen = await this.observeAll(env, generation);
      const definitive = error instanceof ControllerRefusedError && NOTHING_CREATED.has(error.code);
      const idle = seen.every(item => item.kind === 'absent' || (item.kind === 'present' && !item.running));
      return this.report(env, commandId, slotVersion, definitive && idle ? 'stopped' : 'uncertain', generation);
    }
  }

  /** Stop both containers. Report stopped only when both are observed not running. */
  public async shutDown(engagementId: string, commandId: string, slotVersion: number): Promise<EnvironmentCommandResult> {
    const env = await this.environment(engagementId);
    return this.report(env, commandId, slotVersion, await this.stopAll(env, env.generation || 1), env.generation);
  }

  /**
   * The container incarnation this attempt uses. Containers that already exist keep their generation, so a stopped
   * environment starts again as it was. Only when none exist is the next generation created. Disagreement between
   * the containers, or an unknown observation, returns null and the attempt reports uncertain.
   */
  private async incarnation(env: EnvironmentRow): Promise<{ generation: number; seen: Seen[] } | null> {
    const seen = await this.observeAll(env, 1);
    if (seen.some(item => item.kind === 'unknown')) return null;
    const present = seen.filter((item): item is Extract<Seen, { kind: 'present' }> => item.kind === 'present');
    if (present.length === 0) return { generation: env.generation + 1, seen };
    const newest = Math.max(...present.map(item => item.generation));
    return newest >= 1 ? { generation: newest, seen } : null;
  }

  /**
   * Continues the lifecycle work a restart interrupted (ADR-0092 §4.4). A slot still starting is brought up again, and
   * a slot still stopping is stopped again. Both are idempotent, and both move only on what is observed.
   */
  public async resumePending(): Promise<void> {
    const slot = await this.db.deploymentSlot.findUnique({ where: { deploymentId: this.config.deploymentId } });
    if (slot === null || slot.ownerEngagementId === null || slot.commandId === null) return;
    if (slot.phase === 'starting') await this.bringUp(slot.ownerEngagementId, slot.commandId, slot.version);
    if (slot.phase === 'stopping') await this.shutDown(slot.ownerEngagementId, slot.commandId, slot.version);
  }

  private async awaitReady(env: EnvironmentRow, generation: number): Promise<boolean> {

    const endpoint = runtimeUrlFor(this.config.deploymentId, env.id);
    const deadline = Date.now() + this.readinessTimeoutMs;
    for (;;) {
      const seen = await this.observeAll(env, generation);
      // A container still starting counts as running. Only an unhealthy one blocks, and the probe decides the rest.
      const healthy = seen.every(item => item.kind === 'present' && item.running && item.health !== 'unhealthy');
      if (healthy && await this.probe(endpoint)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  /** Stops every running container and reports what is then observed. */
  private async stopAll(env: EnvironmentRow, generation: number): Promise<'stopped' | 'uncertain'> {
    const observed = await this.observeAll(env, generation);
    let unknown = observed.some(item => item.kind === 'unknown');
    for (let index = 0; index < ROLES.length; index++) {
      const item = observed[index];
      if (item?.kind !== 'present' || !item.running) continue;
      try {
        await this.controller.call('stop', { identity: this.identity(env, ROLES[index]!, item.generation), stopTimeoutSeconds: this.config.stopTimeoutSeconds });
      } catch (error) {
        if (!(error instanceof ControllerRefusedError) || error.code !== 'stop_uncertain') unknown = true;
      }
    }
    const after = await this.observeAll(env, generation);
    const stillRunning = after.some(item => item.kind === 'unknown' || (item.kind === 'present' && item.running));
    return unknown || stillRunning ? 'uncertain' : 'stopped';
  }

  private async report(env: EnvironmentRow, commandId: string, slotVersion: number, outcome: 'ready' | 'stopped' | 'uncertain', generation: number): Promise<EnvironmentCommandResult> {
    if (outcome === 'ready') {
      return this.service.observe({ commandId, expectedVersion: slotVersion, observation: 'ready', runtimeUrl: runtimeUrlFor(this.config.deploymentId, env.id), generation });
    }
    return this.service.observe({ commandId, expectedVersion: slotVersion, observation: outcome });
  }

  private async environment(engagementId: string): Promise<EnvironmentRow> {
    const row = await this.db.projectEnvironment.findUniqueOrThrow({
      where: { deploymentId_engagementId: { deploymentId: this.config.deploymentId, engagementId } },
      select: { id: true, generation: true },
    });
    const project = await this.db.engagement.findUniqueOrThrow({ where: { id: engagementId }, select: { workspaceSlug: true } });
    return { id: row.id, generation: row.generation, workspaceSlug: project.workspaceSlug };
  }

  private identity(env: EnvironmentRow, role: ControllerRole, generation: number): ControllerIdentity {
    return { deploymentId: this.config.deploymentId, projectId: env.workspaceSlug, environmentId: env.id, role, generation };
  }

  private request(env: EnvironmentRow, role: ControllerRole, generation: number): ControllerRequest {
    const root = this.config.workspaceHostRoot.replace(/[\\/]+$/, '');
    return {
      identity: this.identity(env, role, generation),
      image: role === 'runtime' ? this.config.runtimeImage : this.config.sandboxImage,
      workspaceSlug: env.workspaceSlug,
      workspaceHostPath: `${root}/${env.workspaceSlug}`,
    };
  }

  private async observeOne(env: EnvironmentRow, role: ControllerRole, generation: number): Promise<Seen> {
    try {
      const observation = await this.controller.call('observe', { identity: this.identity(env, role, generation) });
      if (!observation.exists) return { kind: 'absent' };
      return { kind: 'present', running: observation.running, generation: observation.generation, health: observation.health ?? '' };
    } catch {
      return { kind: 'unknown' };
    }
  }

  private async observeAll(env: EnvironmentRow, generation: number): Promise<Seen[]> {
    return Promise.all(ROLES.map(role => this.observeOne(env, role, generation)));
  }
}
