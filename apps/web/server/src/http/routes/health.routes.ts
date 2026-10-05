import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RuntimeContextService } from '../../services/runtime/runtime-context.js';

export type HealthCheckStatus = 'ok' | 'not_connected' | 'not_configured' | 'not_checked';

export interface HealthCheck {
  readonly status: HealthCheckStatus;
  readonly reason?: 'service_missing';
}

export type DatabaseHealthResult =
  | { readonly status: 'ok' }
  | { readonly status: 'not_connected' };

/**
 * Dependency-aware database readiness seam. `check()` is awaited per
 * readiness request; `dispose()` (optional) is invoked once when the app
 * closes. Implementations must never throw out of `check()`.
 */
export interface DatabaseHealth {
  check(): Promise<DatabaseHealthResult>;
  dispose?(): Promise<void>;
}

export interface LivenessResponse {
  readonly scope: 'process_liveness';
  readonly notProbed: readonly string[];
  readonly status: 'ok';
  readonly service: string;
  readonly checks: {
    readonly bootstrap: HealthCheck;
    readonly integrations: HealthCheck;
  };
}

export interface ReadinessResponse {
  readonly scope: 'dependency_wiring';
  readonly notProbed: readonly string[];
  /** `degraded` = at least the database dependency is healthy. */
  readonly status: 'ok' | 'unavailable' | 'degraded';
  readonly service: string;
  readonly checks: {
    readonly bootstrap: HealthCheck;
    readonly integrations: HealthCheck;
    readonly database: HealthCheck;
    readonly runtime: HealthCheck;
  };
}

const LIVENESS_RESPONSE: LivenessResponse = {
  scope: 'process_liveness',
  notProbed: ['database', 'runtime_catalog', 'model_inference', 'tool_execution', 'provider_operations'],
  status: 'ok',
  service: 'web-raptix-server',
  checks: {
    bootstrap: { status: 'ok' },
    integrations: { status: 'not_checked' },
  },
};

function toHealthCheck(result: DatabaseHealthResult): HealthCheck {
  return result.status === 'ok' ? { status: 'ok' } : { status: 'not_connected' };
}

export interface HealthRouteOptions {
  readonly databaseHealth?: DatabaseHealth;
  readonly runtimeContext?: RuntimeContextService;
}

/** Never throws: a probe failure is reported as `not_connected`. */
export async function probeDatabase(
  databaseHealth: DatabaseHealth,
): Promise<HealthCheck> {
  try {
    return toHealthCheck(await databaseHealth.check());
  } catch {
    return { status: 'not_connected' };
  }
}

export function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions = {},
): void {
  app.get('/api/health', async () => LIVENESS_RESPONSE);

  app.get(
    '/api/health/ready',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const database = options.databaseHealth
        ? await probeDatabase(options.databaseHealth)
        : { status: 'not_configured' as const, reason: 'service_missing' as const };
      let runtime: HealthCheck = { status: 'not_connected', reason: 'service_missing' };
      if (options.runtimeContext) {
        try { runtime = { status: (await options.runtimeContext.agents()).graphs.length ? 'ok' : 'not_connected' }; }
        catch { runtime = { status: 'not_connected' }; }
      }
      const ready = database.status === 'ok' && runtime.status === 'ok';
      const response: ReadinessResponse = {
        scope: 'dependency_wiring',
        notProbed: ['model_inference', 'tool_execution', 'provider_operations'],
        status: ready ? 'ok' : database.status === 'ok' ? 'degraded' : 'unavailable',
        service: 'web-raptix-server',
        checks: {
          bootstrap: { status: 'ok' },
          integrations: ready ? { status: 'ok' } : { status: 'not_connected', reason: 'service_missing' },
          database,
          runtime,
        },
      };
      reply.status(ready ? 200 : 503);
      return response;
    },
  );
}
