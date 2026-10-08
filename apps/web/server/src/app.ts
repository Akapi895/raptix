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
import type { RunService } from './services/runtime/run-service.js';
import { registerRunRoutes } from './http/routes/runs.routes.js';
import { registerApprovalRoutes } from './http/routes/approvals.routes.js';
import { registerFindingsRoutes } from './http/routes/findings.routes.js';
import { registerGraphRoutes } from './http/routes/graph.routes.js';
import { registerTimelineRoutes } from './http/routes/timeline.routes.js';
import { registerSettingsRoutes } from './http/routes/settings.routes.js';
import { registerCampaignRoutes } from './http/routes/campaign.routes.js';
import { registerVaultRoutes } from './http/routes/vault.routes.js';
import { registerMembersRoutes } from './http/routes/members.routes.js';
import type { StreamService } from './services/runtime/stream-service.js';
import { registerEventRoutes } from './http/routes/events.routes.js';
import type { ApprovalsService } from './services/approvals-service.js';
import type { FindingsService } from './services/findings-service.js';
import type { ArtifactsService } from './services/artifacts-service.js';
import type { GraphService } from './services/graph-service.js';
import type { TimelineService } from './services/timeline-service.js';
import type { ExportService } from './services/export-service.js';
import type { SettingsService } from './services/settings-service.js';
import type { CampaignService } from './services/campaign-service.js';
import type { C2Service } from './services/c2-service.js';
import type { VaultService } from './services/vault-service.js';
import type { MembersService } from './services/members-service.js';

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
  readonly runsService?: RunService;
  readonly streamService?: StreamService;
  readonly approvalsService?: ApprovalsService;
  readonly findingsService?: FindingsService;
  readonly artifactsService?: ArtifactsService;
  readonly graphService?: GraphService;
  readonly timelineService?: TimelineService;
  readonly exportService?: ExportService;
  readonly settingsService?: SettingsService;
  readonly campaignsService?: CampaignService;
  readonly c2Service?: C2Service;
  readonly vaultService?: VaultService;
  readonly membersService?: MembersService;
  /** Whether VAULT_ENCRYPTION_KEY decoded to a usable 32-byte key. */
  readonly vaultKeyConfigured?: boolean;
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
    runsSupported: options.runsService !== undefined,
    approvalsSupported: options.approvalsService !== undefined,
    findingsSupported: options.findingsService !== undefined,
    artifactsSupported: options.artifactsService !== undefined,
    graphsSupported: options.graphService !== undefined,
    timelineSupported: options.timelineService !== undefined,
    reportsSupported: options.exportService !== undefined,
    campaignsSupported: options.campaignsService !== undefined,
    c2Supported: options.c2Service !== undefined,
    c2ProviderConfigured: options.c2Service?.configured === true,
    vaultSupported: options.vaultService !== undefined,
    vaultKeyConfigured: options.vaultService !== undefined && options.vaultKeyConfigured === true,
    membersSupported: options.membersService !== undefined,
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

  if (options.runsService) registerRunRoutes(app, options.runsService, options.identity ?? getLocalIdentity());
  if (options.streamService) registerEventRoutes(app, options.streamService, options.identity ?? getLocalIdentity());
  if (options.approvalsService) registerApprovalRoutes(app, options.approvalsService, options.identity ?? getLocalIdentity());
  if (options.findingsService && options.artifactsService) registerFindingsRoutes(app, options.findingsService, options.artifactsService, options.identity ?? getLocalIdentity());
  if (options.graphService) registerGraphRoutes(app, options.graphService, options.identity ?? getLocalIdentity());
  if (options.timelineService && options.exportService) registerTimelineRoutes(app, options.timelineService, options.exportService, options.identity ?? getLocalIdentity());
  if (options.settingsService) registerSettingsRoutes(app, options.settingsService, options.identity ?? getLocalIdentity());
  if (options.campaignsService && options.c2Service) registerCampaignRoutes(app, options.campaignsService, options.c2Service, options.identity ?? getLocalIdentity());
  if (options.vaultService) registerVaultRoutes(app, options.vaultService, options.identity ?? getLocalIdentity());
  if (options.membersService) registerMembersRoutes(app, options.membersService, options.identity ?? getLocalIdentity());

  if (options.runtimeOwnership) {
    const ownership = options.runtimeOwnership;
    const sweep = (): void => { void ownership.sweepStaleCreating().then(() => options.runsService?.reconcileStale()).catch(err => app.log.error({ err }, 'request ledger stale sweep failed')); };
    app.addHook('onReady', async () => {
      try { await ownership.sweepStaleCreating(); }
      catch (err) { app.log.error({ err }, 'request ledger startup sweep failed'); }
      void options.runsService?.reconcileStale().catch(err => app.log.error({ err }, 'startup runtime reconciliation failed'));
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
