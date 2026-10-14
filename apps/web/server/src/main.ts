import { mkdir } from 'node:fs/promises';
import { getLocalIdentity } from './auth/identity-provider.js';
import { buildApp } from './app.js';
import { EnvValidationError, readServerEnv } from './config/env.js';
import { createDbClient, disconnectDb } from './db/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { DatabaseHealth } from './http/routes/health.routes.js';
import { EngagementsRepository } from './repositories/engagements-repository.js';
import { ProjectsService } from './services/projects-service.js';
import { RuntimeOwnershipService } from './services/runtime-ownership.js';
import { loadRuntimeConfig } from './config/runtime.js';
import { RuntimeExecutionClient } from './integrations/runtime/execution-client.js';
import { RuntimeContextService } from './services/runtime/runtime-context.js';
import { RunService } from './services/runtime/run-service.js';
import { StreamService } from './services/runtime/stream-service.js';
import { RuntimeJoinClient } from './integrations/runtime/join-client.js';
import { ApprovalsService } from './services/approvals-service.js';
import { FindingsService } from './services/findings-service.js';
import { ArtifactsService } from './services/artifacts-service.js';
import { GraphService } from './services/graph-service.js';
import { TimelineService } from './services/timeline-service.js';
import { ExportService } from './services/export-service.js';
import { SettingsService } from './services/settings-service.js';
import { CampaignService } from './services/campaign-service.js';
import { GoPhishClient } from './integrations/campaigns/gophish-client.js';
import { EvilginxClient } from './integrations/campaigns/evilginx-client.js';
import { C2Service } from './services/c2-service.js';
import { SliverClient } from './integrations/c2/sliver-client.js';
import { VaultService } from './services/vault-service.js';
import { MembersService } from './services/members-service.js';
import { ScopeService } from './services/scope-service.js';
import { GovernanceService } from './services/governance-service.js';
import { FindingsWorkflowService } from './services/findings-workflow-service.js';
import { ReportsService } from './services/reports-service.js';
import { C2GrantsService } from './services/c2-grants-service.js';
import { FleetService } from './services/fleet-service.js';
import { LibraryService } from './services/library-service.js';
import { InboxService } from './services/inbox-service.js';
import { WorkspaceSettingsService } from './services/workspace-settings-service.js';
import { AuditService } from './services/audit-service.js';
import { ClosureService } from './services/closure-service.js';
import { ensureBootstrapAdmin } from './http/routes/auth.routes.js';

let closing = false;

/**
 * Own database health probe: cheap liveness query, failures reported as
 * `not_connected`. Never throws; never logs the connection string.
 */
function createDatabaseHealth(client: PrismaClient): DatabaseHealth {
  return {
    async check() {
      try {
        await client.$queryRaw`SELECT 1`;
        return { status: 'ok' as const };
      } catch {
        return { status: 'not_connected' as const };
      }
    },
  };
}

async function main(): Promise<void> {
  const env = readServerEnv();
  const runtimeConfig = loadRuntimeConfig(process.env);

  let dbClient: PrismaClient | undefined;
  let projectsService: ProjectsService | undefined;
  let databaseHealth: DatabaseHealth | undefined;

  // The workspace root is validated/created ONLY at the explicitly passed
  // location â€” never a default, never derived from request input.
  if (env.workspacePath !== undefined) {
    try {
      await mkdir(env.workspacePath, { recursive: true });
    } catch (error) {
      throw new Error(
        `failed to prepare WORKSPACE_PATH: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Lazy owned integration stack: constructed only when DATABASE_URL is
  // explicitly configured. No auto-migrate, no auto-generate, no fallbacks.
  if (env.databaseUrl !== undefined) {
    if (env.workspacePath === undefined) {
      throw new EnvValidationError([
        'WORKSPACE_PATH is required when DATABASE_URL is configured',
      ]);
    }
    dbClient = createDbClient({ connectionString: env.databaseUrl });
    databaseHealth = createDatabaseHealth(dbClient);
    projectsService = new ProjectsService({
      repository: new EngagementsRepository(dbClient.engagement),
      workspaceRoot: env.workspacePath,
      identity: getLocalIdentity(),
    });
  }

  const ownership = dbClient ? new RuntimeOwnershipService(dbClient) : undefined;
  const runtime = runtimeConfig ? new RuntimeExecutionClient(runtimeConfig.apiUrl) : undefined;
  const approvalsService = dbClient && projectsService && env.workspacePath ? new ApprovalsService(dbClient, env.workspacePath) : undefined;
  const closureService = dbClient ? new ClosureService(dbClient, approvalsService ? async (userId, engagementId) => (await approvalsService.list(userId, engagementId)).approvals.length : undefined) : undefined;
  const runtimeContext = runtimeConfig && runtime && projectsService && ownership && env.workspacePath
    ? new RuntimeContextService({
        config: runtimeConfig,
        projects: projectsService,
        ownership,
        workspaceRoot: env.workspacePath,
        runtime,
        // Ticket 17: every create-thread/submit/resume resolves context first —
        // this is the atomic post-close execution gate.
        assertEngagementOpen: closureService ? (engagementId) => closureService.assertOpen(engagementId) : undefined,
      }) : undefined;
  const runsService = ownership && runtimeContext && runtime ? new RunService({ ownership, context: runtimeContext, runtime, reads: runtime }) : undefined;
  const fleetService = dbClient && runtimeContext && runsService ? new FleetService(dbClient, runtimeContext, runsService) : undefined;
  const findingsService = dbClient && env.workspacePath ? new FindingsService(dbClient, env.workspacePath) : undefined;
  const artifactsService = dbClient && env.workspacePath ? new ArtifactsService(dbClient, env.workspacePath) : undefined;
  const graphService = dbClient && env.graph ? new GraphService(dbClient, env.graph) : undefined;
  const libraryService = graphService && env.graph ? new LibraryService(graphService, env.graph) : undefined;
  const timelineService = runsService && artifactsService && dbClient && env.workspacePath ? new TimelineService(dbClient, runsService, artifactsService, env.workspacePath) : undefined;
  const exportService = dbClient && env.workspacePath ? new ExportService(dbClient, env.workspacePath) : undefined;
  const settingsService = dbClient ? new SettingsService(dbClient, getLocalIdentity()) : undefined;
  const campaignsService = dbClient ? new CampaignService(dbClient, env.gophish ? new GoPhishClient(env.gophish) : undefined, env.evilginx ? new EvilginxClient(env.evilginx) : undefined) : undefined;
  const workspaceSettings = dbClient ? new WorkspaceSettingsService(dbClient, env.authMode === 'multi') : undefined;
  const c2Grants = dbClient ? new C2GrantsService(dbClient, workspaceSettings ? () => workspaceSettings.maxGrantHours() : undefined) : undefined;
  const auditService = dbClient ? new AuditService(dbClient) : undefined;
  const c2Service = dbClient ? new C2Service(dbClient, env.sliver ? new SliverClient(env.sliver) : undefined, c2Grants?.assertCommandAuthorized.bind(c2Grants)) : undefined;
  const vaultService = dbClient ? new VaultService(dbClient, env.vaultKey ?? null) : undefined;
  const membersService = dbClient ? new MembersService(dbClient, env.authMode === 'multi') : undefined;
  const scopeService = dbClient ? new ScopeService(dbClient) : undefined;
  const governanceService = dbClient && scopeService ? new GovernanceService(dbClient, scopeService) : undefined;
  const inboxService = dbClient && governanceService ? new InboxService(dbClient, governanceService) : undefined;
  const findingsWorkflow = dbClient ? new FindingsWorkflowService(dbClient) : undefined;
  const reportsService = dbClient && exportService ? new ReportsService(dbClient, async (userId, engagementId, format) => {
    const result = await exportService.export(userId, engagementId, format as 'json' | 'markdown');
    return { ok: result.body.length > 0, format };
  }) : undefined;
  const app = await buildApp({
    logger: { level: env.logLevel },
    projectsService,
    databaseHealth,
    runtimeOwnership: ownership,
    runtimeContext,
    runsService,
    streamService: runsService && runtimeConfig ? new StreamService(runsService, new RuntimeJoinClient(runtimeConfig.apiUrl)) : undefined,
    approvalsService,
    findingsService,
    artifactsService,
    graphService,
  timelineService,
  exportService,
  settingsService,
  campaignsService,
  c2Service,
  c2Grants,
  fleetService,
  libraryService,
  inboxService,
  workspaceSettings,
  auditService,
  closureService,
  vaultService,
  membersService,
  scopeService,
  governanceService,
  findingsWorkflow,
  reportsService,
  vaultKeyConfigured: env.vaultKey !== undefined,
  authMode: env.authMode,
  authDb: dbClient,
  secureCookies: env.secureCookies,
  adminBootstrap: env.adminBootstrap,
  });
  if (env.authMode === 'multi' && dbClient && env.adminBootstrap) {
    await ensureBootstrapAdmin(dbClient, env.adminBootstrap.username, env.adminBootstrap.password, env.adminBootstrap.displayName);
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutdown signal received, closing HTTP server');
    try {
      await app.close();
      if (dbClient) await disconnectDb(dbClient);
      app.log.info('HTTP server closed');
      process.exit(0);
    } catch (error) {
      app.log.error({ error }, 'HTTP shutdown failed');
      process.exit(1);
    }
  };

  try {
    await app.listen({ port: env.port, host: env.host });
  } catch (error) {
    await app.close();
    if (dbClient) await disconnectDb(dbClient);
    throw error;
  }

  app.log.info(
    {
      host: env.host,
      port: env.port,
      nodeEnv: env.nodeEnv,
      database: env.databaseUrl !== undefined ? 'configured' : 'not_configured',
      projectsApi: projectsService !== undefined ? 'enabled' : 'disabled',
    },
    'web-raptix-server listening',
  );

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`web-raptix-server failed to start: ${message}\n`);
  process.exit(1);
}
