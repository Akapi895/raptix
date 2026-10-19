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

type Seen =
  | { kind: 'absent' }
  | { kind: 'present'; running: boolean; generation: number }
  | { kind: 'unknown' };

interface EnvironmentRow { id: string; generation: number; workspaceSlug: string }

const ROLES: readonly ControllerRole[] = ['runtime', 'sandbox'];
/** Refusals that prove nothing of this environment was created, so the slot may be released when nothing runs. */
const NOTHING_CREATED = new Set(['foreign_resource', 'generation_mismatch', 'image_missing', 'rejected_path', 'rejected_image', 'invalid_request']);

/**
 * Drives the host controller for one command the environment service already accepted (ADR-0092 §4.3).
 * The slot moves only on what was observed. An unknown outcome keeps the slot held as `uncertain`.
 */
export class EnvironmentLifecycle {
  public constructor(
    private readonly db: PrismaClient,
    private readonly service: ProjectEnvironmentService,
    private readonly controller: HostControllerClient,
    private readonly config: LifecycleConfig,
  ) {}

  /** Create and start both containers, confirm both run, then report ready with the runtime endpoint. */
  public async bringUp(engagementId: string, commandId: string, slotVersion: number): Promise<EnvironmentCommandResult> {
    const env = await this.environment(engagementId);
    const generation = env.generation + 1;
    try {
      for (const role of ROLES) await this.controller.call('ensure', this.request(env, role, generation));
      for (const role of ROLES) await this.controller.call('start', { identity: this.identity(env, role, generation) });
      const seen = await this.observeAll(env, generation);
      const allRunning = seen.every(item => item.kind === 'present' && item.running);
      return this.report(env, commandId, slotVersion, allRunning ? 'ready' : 'uncertain');
    } catch (error) {
      const seen = await this.observeAll(env, generation);
      const definitive = error instanceof ControllerRefusedError && NOTHING_CREATED.has(error.code);
      const idle = seen.every(item => item.kind === 'absent' || (item.kind === 'present' && !item.running));
      return this.report(env, commandId, slotVersion, definitive && idle ? 'stopped' : 'uncertain');
    }
  }

  /** Stop both containers. Report stopped only when both are observed not running. */
  public async shutDown(engagementId: string, commandId: string, slotVersion: number): Promise<EnvironmentCommandResult> {
    const env = await this.environment(engagementId);
    const observed = await this.observeAll(env, env.generation || 1);
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
    const after = await this.observeAll(env, env.generation || 1);
    const stillRunning = after.some(item => item.kind === 'unknown' || (item.kind === 'present' && item.running));
    return this.report(env, commandId, slotVersion, unknown || stillRunning ? 'uncertain' : 'stopped');
  }

  private async report(env: EnvironmentRow, commandId: string, slotVersion: number, outcome: 'ready' | 'stopped' | 'uncertain'): Promise<EnvironmentCommandResult> {
    if (outcome === 'ready') {
      return this.service.observe({ commandId, expectedVersion: slotVersion, observation: 'ready', runtimeUrl: runtimeUrlFor(this.config.deploymentId, env.id) });
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
      return { kind: 'present', running: observation.running, generation: observation.generation };
    } catch {
      return { kind: 'unknown' };
    }
  }

  private async observeAll(env: EnvironmentRow, generation: number): Promise<Seen[]> {
    return Promise.all(ROLES.map(role => this.observeOne(env, role, generation)));
  }
}
