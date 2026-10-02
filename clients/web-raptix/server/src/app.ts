import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { getLocalIdentity } from './auth/identity-provider.js';
import type { LocalIdentity } from './auth/identity-provider.js';
import { registerErrorHandler } from './http/error-handler.js';
import { registerCapabilitiesRoutes } from './http/routes/capabilities.routes.js';
import { registerHealthRoutes } from './http/routes/health.routes.js';
import type { DatabaseHealth } from './http/routes/health.routes.js';
import { registerProjectRoutes } from './http/routes/projects.routes.js';
import type { ProjectsService } from './services/projects-service.js';
import type { RuntimeOwnershipService } from './services/runtime-ownership.js';
import type { RuntimeContextService } from './services/runtime/runtime-context.js';

export interface AppOptions {
  readonly logger?: FastifyServerOptions['logger'];
  /**
   * Registered project service. When provided, /api/engagements routes are
   * registered and the `projects` capability is supported/available. When
   * absent the routes stay unregistered (404 envelope) and every business
   * capability reports service_missing.
   */
  readonly projectsService?: ProjectsService;
  readonly runtimeOwnership?: RuntimeOwnershipService;
  readonly runtimeContext?: RuntimeContextService;
  /** Local single-user identity; defaults to getLocalIdentity(). */
  readonly identity?: LocalIdentity;
  /**
   * Dependency-aware database readiness probe. Its optional `dispose` runs
   * once via the Fastify onClose hook when the app closes.
   */
  readonly databaseHealth?: DatabaseHealth;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  registerErrorHandler(app);
  registerHealthRoutes(app, { databaseHealth: options.databaseHealth, runtimeContext: options.runtimeContext });
  registerCapabilitiesRoutes(app, {
    projectsSupported: options.projectsService !== undefined,
    databaseHealth: options.databaseHealth,
    runtimeContext: options.runtimeContext,
  });

  if (options.projectsService !== undefined) {
    const identity: LocalIdentity = options.identity ?? getLocalIdentity();
    registerProjectRoutes(app, {
      service: options.projectsService,
      identity,
      ownership: options.runtimeOwnership,
      runtimeContext: options.runtimeContext,
    });
  }

  if (options.runtimeOwnership) {
    const ownership = options.runtimeOwnership;
    const sweep = (): void => { void ownership.sweepStaleCreating().catch(err => app.log.error({ err }, 'request ledger stale sweep failed')); };
    app.addHook('onReady', async () => {
      try { await ownership.sweepStaleCreating(); }
      catch (err) { app.log.error({ err }, 'request ledger startup sweep failed'); }
    });
    const timer = setInterval(sweep, 30_000);
    timer.unref();
    app.addHook('onClose', async () => { clearInterval(timer); });
  }

  const disposeDatabase = options.databaseHealth?.dispose?.bind(
    options.databaseHealth,
  );
  if (disposeDatabase) {
    app.addHook('onClose', async () => {
      await disposeDatabase();
    });
  }

  return app;
}
