import type { PrismaClient } from '../../generated/prisma/client.js';
import { ProjectApiError } from '../../services/projects-service.js';
import { RuntimeExecutionClient, type RuntimeExecutionPort } from './execution-client.js';
import { RuntimeJoinClient, type RuntimeJoinPort } from './join-client.js';
import { RuntimeReadClient, type RuntimeReadPort } from './read-client.js';

/** A managed project's environment as recorded by the environment service (ADR-0092). */
export interface EnvironmentRoute {
  environmentId: string;
  observedState: string;
  generation: number;
  runtimeUrl: string | null;
}

export interface EnvironmentRouteSource {
  route(engagementId: string): Promise<EnvironmentRoute | null>;
}

export interface RuntimeEndpoint {
  apiUrl: string;
  /** Null for a legacy project that has no environment record yet. */
  environmentId: string | null;
  generation: number | null;
}

const NOT_READY: Record<string, string> = {
  starting: 'The project environment is starting. Wait for it to become ready.',
  stopping: 'The project environment is stopping.',
  stopped: 'The project environment is stopped. Activate it to run or read its runtime state.',
  unprovisioned: 'The project environment is stopped. Activate it to run or read its runtime state.',
  uncertain: 'The project environment state is uncertain. Reconcile it before continuing.',
};

/** An explicit, named state. It is never an empty answer and never a fallback to another runtime. */
export class EnvironmentNotReadyError extends ProjectApiError {
  public constructor(public readonly state: string) {
    super(503, NOT_READY[state] ?? 'The project environment has no runtime endpoint yet.');
  }
}

/**
 * Chooses the runtime endpoint for one engagement on every call. A project with no environment record uses
 * the configured legacy runtime. A managed project must be ready, and then it uses only the endpoint its
 * environment recorded. There is no cache, so a generation change or a stop is seen on the next call.
 */
export class RuntimeRouter {
  public constructor(private readonly legacyApiUrl: string, private readonly source: EnvironmentRouteSource, private readonly apiToken?: string) {}

  public async endpoint(engagementId: string): Promise<RuntimeEndpoint> {
    const route = await this.source.route(engagementId);
    if (route === null) return { apiUrl: this.legacyApiUrl, environmentId: null, generation: null };
    if (route.observedState !== 'ready' || route.runtimeUrl === null) throw new EnvironmentNotReadyError(route.observedState);
    return { apiUrl: route.runtimeUrl, environmentId: route.environmentId, generation: route.generation };
  }

  public async execution(engagementId: string): Promise<RuntimeExecutionPort> {
    return new RuntimeExecutionClient((await this.endpoint(engagementId)).apiUrl, undefined, undefined, this.apiToken);
  }

  public async reads(engagementId: string): Promise<RuntimeReadPort> {
    return new RuntimeReadClient((await this.endpoint(engagementId)).apiUrl, undefined, undefined, this.apiToken);
  }

  public async join(engagementId: string): Promise<RuntimeJoinPort> {
    return new RuntimeJoinClient((await this.endpoint(engagementId)).apiUrl, undefined, this.apiToken);
  }
}

export function prismaRouteSource(db: PrismaClient, deploymentId: string): EnvironmentRouteSource {
  return {
    async route(engagementId) {
      const row = await db.projectEnvironment.findUnique({
        where: { deploymentId_engagementId: { deploymentId, engagementId } },
        select: { id: true, observedState: true, generation: true, runtimeUrl: true },
      });
      return row === null ? null : { environmentId: row.id, observedState: row.observedState, generation: row.generation, runtimeUrl: row.runtimeUrl };
    },
  };
}
