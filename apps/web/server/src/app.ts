import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { getLocalIdentity } from './auth/identity-provider.js';
import type { LocalIdentity } from './auth/identity-provider.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { ActorContextStore, registerMultiUserAuth, sessionAwareIdentity } from './auth/request-identity.js';
import { registerAuthRoutes } from './http/routes/auth.routes.js';
import { registerEngagementMutationFence } from './security/engagement-mutation-fence.js';
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
import { registerScopeRoutes } from './http/routes/scope.routes.js';
import { registerGovernanceRoutes } from './http/routes/governance.routes.js';
import { registerScheduleRoutes } from './http/routes/schedule.routes.js';
import { registerFindingsWorkflowRoutes } from './http/routes/findings-workflow.routes.js';
import { registerReportsRoutes } from './http/routes/reports.routes.js';
import { registerC2GrantRoutes } from './http/routes/c2-grants.routes.js';
import { registerFleetRoutes } from './http/routes/fleet.routes.js';
import { registerLibraryRoutes } from './http/routes/library.routes.js';
import { registerLibraryReviewRoutes } from './http/routes/library-review.routes.js';
import { registerInboxRoutes } from './http/routes/inbox.routes.js';
import { registerWorkspaceSettingsRoutes, registerAuditRoutes } from './http/routes/workspace.routes.js';
import { registerClosureRoutes } from './http/routes/closure.routes.js';
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
import type { ScopeService } from './services/scope-service.js';
import type { DocumentDraftService } from './services/document-draft-service.js';
import { registerDocumentRoutes } from './http/routes/documents.routes.js';
import type { GovernanceService } from './services/governance-service.js';
import type { ScheduleService } from './services/schedule-service.js';
import type { FindingsWorkflowService } from './services/findings-workflow-service.js';
import type { ReportsService } from './services/reports-service.js';
import type { C2GrantsService } from './services/c2-grants-service.js';
import type { FleetService } from './services/fleet-service.js';
import type { LibraryService } from './services/library-service.js';
import type { LibraryReviewService } from './services/library-review-service.js';
import type { InboxService } from './services/inbox-service.js';
import type { WorkspaceSettingsService } from './services/workspace-settings-service.js';
import type { AuditService } from './services/audit-service.js';
import type { ClosureService } from './services/closure-service.js';

export interface AppOptions {
  readonly deploymentId?: string;
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
  readonly scopeService?: ScopeService;
  readonly documentDrafts?: DocumentDraftService;
  readonly governanceService?: GovernanceService;
  readonly scheduleService?: ScheduleService;
  readonly findingsWorkflow?: FindingsWorkflowService;
  readonly reportsService?: ReportsService;
  readonly c2Grants?: C2GrantsService;
  readonly fleetService?: FleetService;
  readonly libraryService?: LibraryService;
  readonly libraryReviewService?: LibraryReviewService;
  readonly inboxService?: InboxService;
  readonly workspaceSettings?: WorkspaceSettingsService;
  readonly auditService?: AuditService;
  readonly closureService?: ClosureService;
  /** Runtime cancel bridge for emergency stops (operation scope). */
  readonly cancelRun?: (threadId: string, runId: string | null, actorId: string, engagementId: string) => Promise<string>;
  /** W10/ADR-0074: runtime observation bridge for workspace-scope stop authority. */
  readonly hasActiveRuns?: (actorId: string, engagementId: string) => Promise<boolean>;
  /** Whether VAULT_ENCRYPTION_KEY decoded to a usable 32-byte key. */
  readonly vaultKeyConfigured?: boolean;
  /** Local single-user identity; defaults to getLocalIdentity(). */
  readonly identity?: LocalIdentity;
  /** Ticket 07: `multi` enables session/CSRF/origin auth at the HTTP boundary. */
  readonly authMode?: 'local' | 'multi';
  /** Prisma client for session lookup + bootstrap admin; required in multi mode. */
  readonly authDb?: PrismaClient;
  readonly workflowDb?: PrismaClient;
  readonly secureCookies?: boolean;
  readonly adminBootstrap?: { readonly username: string; readonly password: string; readonly displayName: string };
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

  // Ticket 07: in multi mode the session gate must be registered before any
  // route so every handler (including previously registered ones is not a
  // thing â€” registration order below) runs behind the same-origin/CSRF check.
  const actors = new ActorContextStore();
  if (options.authMode === 'multi' && !options.authDb) throw new Error('Multi-user authentication requires a database.');
  let identity: LocalIdentity = options.identity ?? getLocalIdentity();
  const multiAuth = options.authMode === 'multi' && options.authDb !== undefined;
  if (multiAuth && options.authDb) {
    registerMultiUserAuth(app, actors, {
      db: options.authDb,
      publicUrls: ['/api/auth/login', '/api/auth/session', '/api/capabilities', '/api/health', '/api/health/ready'],
    });
    identity = sessionAwareIdentity(actors);
    registerAuthRoutes(app, options.authDb, actors, options.secureCookies ?? false);
  }

  registerErrorHandler(app);
  if (options.workflowDb) registerEngagementMutationFence(app, options.workflowDb, () => identity.id);
  registerHealthRoutes(app, { databaseHealth: options.databaseHealth, runtimeContext: options.runtimeContext });
  registerCapabilitiesRoutes(app, {
    deploymentId: options.deploymentId,
    mode: multiAuth ? 'multi-user' : 'local-single-user',
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
    registerProjectRoutes(app, {
      service: options.projectsService,
      identity,
      ownership: options.runtimeOwnership,
      runtimeContext: options.runtimeContext,
    });
  }

  if (options.runsService) registerRunRoutes(app, options.runsService, identity);
  if (options.streamService) registerEventRoutes(app, options.streamService, identity);
  if (options.approvalsService) registerApprovalRoutes(app, options.approvalsService, identity);
  if (options.findingsService && options.artifactsService) registerFindingsRoutes(app, options.findingsService, options.artifactsService, identity);
  if (options.graphService) registerGraphRoutes(app, options.graphService, identity);
  if (options.timelineService && options.exportService) registerTimelineRoutes(app, options.timelineService, options.exportService, identity);
  if (options.settingsService) registerSettingsRoutes(app, options.settingsService, identity);
  if (options.campaignsService && options.c2Service) registerCampaignRoutes(app, options.campaignsService, options.c2Service, identity);
  if (options.vaultService) registerVaultRoutes(app, options.vaultService, identity);
  if (options.membersService) registerMembersRoutes(app, options.membersService, identity);
  if (options.scopeService) registerScopeRoutes(app, options.scopeService, identity);
  if (options.documentDrafts) registerDocumentRoutes(app, options.documentDrafts, identity);
  if (options.governanceService) registerGovernanceRoutes(app, options.governanceService, identity, options.cancelRun, options.hasActiveRuns);
  if (options.scheduleService) registerScheduleRoutes(app, options.scheduleService, identity);
  if (options.findingsWorkflow) registerFindingsWorkflowRoutes(app, options.findingsWorkflow, identity);
  if (options.reportsService) registerReportsRoutes(app, options.reportsService, identity);
  if (options.c2Grants) registerC2GrantRoutes(app, options.c2Grants, identity);
  if (options.fleetService) registerFleetRoutes(app, options.fleetService, identity);
  if (options.libraryService) registerLibraryRoutes(app, options.libraryService, identity);
  if (options.libraryReviewService) registerLibraryReviewRoutes(app, options.libraryReviewService, identity);
  if (options.inboxService) registerInboxRoutes(app, options.inboxService, identity);
  if (options.workspaceSettings) registerWorkspaceSettingsRoutes(app, options.workspaceSettings, identity);
  if (options.auditService) registerAuditRoutes(app, options.auditService, identity);
  if (options.closureService) registerClosureRoutes(app, options.closureService, identity);

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
