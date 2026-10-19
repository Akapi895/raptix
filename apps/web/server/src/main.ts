import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ScopedRunView } from '@raptix/web-contracts';
import { getLocalIdentity } from './auth/identity-provider.js';
import { buildApp } from './app.js';
import { EnvValidationError, readServerEnv } from './config/env.js';
import { createDbClient, disconnectDb } from './db/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { DatabaseHealth } from './http/routes/health.routes.js';
import { EngagementsRepository } from './repositories/engagements-repository.js';
import { ProjectsService, ProjectApiError } from './services/projects-service.js';
import { RuntimeOwnershipService } from './services/runtime-ownership.js';
import { ProjectEnvironmentService } from './services/environments/project-environment-service.js';
import { loadRuntimeConfig } from './config/runtime.js';
import { RuntimeExecutionClient } from './integrations/runtime/execution-client.js';
import { RuntimeContextService, EXECUTION_ASSISTANTS } from './services/runtime/runtime-context.js';
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
import { DocumentDraftService } from './services/document-draft-service.js';
import { GovernanceService, type PreflightCheck, type ReadinessInput } from './services/governance-service.js';
import { ScheduleService } from './services/schedule-service.js';
import { FindingsWorkflowService } from './services/findings-workflow-service.js';
import { ReportsService } from './services/reports-service.js';
import { C2GrantsService } from './services/c2-grants-service.js';
import { FleetService } from './services/fleet-service.js';
import { LibraryService } from './services/library-service.js';
import { LibraryReviewService } from './services/library-review-service.js';
import { InboxService } from './services/inbox-service.js';
import { WorkspaceSettingsService } from './services/workspace-settings-service.js';
import { AuditService } from './services/audit-service.js';
import { ClosureService } from './services/closure-service.js';
import { ensureBootstrapAdmin } from './http/routes/auth.routes.js';
import { requireEngagementAccess } from './auth/membership-policy.js';

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
  // ADR-0085: the scope service is built below, after the projects service; the handoff reaches it through this holder.
  const plannerScope: { confirm?: ScopeService['confirmPlannerScope'] } = {};
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
      repository: new EngagementsRepository(dbClient.engagement, env.authMode === 'multi' ? dbClient.webMembership : undefined),
      workspaceRoot: env.workspacePath,
      identity: getLocalIdentity(),
      confirmPlannerScope: (actorId, engagementId, plan) => {
        if (plannerScope.confirm === undefined) throw new ProjectApiError(409, 'The planning scope cannot be approved without the database.');
        return plannerScope.confirm(actorId, engagementId, plan);
      },
    });
  }

  // ADR-0092: every run-starting path is admitted by the same deployment slot.
  const environments = dbClient ? new ProjectEnvironmentService(dbClient, env.deploymentId ?? 'default') : undefined;
  const ownership = dbClient ? new RuntimeOwnershipService(dbClient, environments) : undefined;
  const runtime = runtimeConfig ? new RuntimeExecutionClient(runtimeConfig.apiUrl) : undefined;
  const approvalsService = dbClient && projectsService && env.workspacePath ? new ApprovalsService(dbClient, env.workspacePath) : undefined;
   const closureService = dbClient ? new ClosureService(dbClient, approvalsService ? async (_userId, engagementId) => {
     const engagement = await dbClient.engagement.findUniqueOrThrow({ where: { id: engagementId } });
     return (await approvalsService.list(engagement.userId, engagementId)).approvals.length;
   } : undefined, {
     sessions: async (_actorId, engagementId) => {
       if (!c2Service?.configured) {
         const commands = await dbClient.c2Command.count({ where: { engagementId } });
         if (commands > 0) throw new TypeError('The provider is unavailable for previously used C2 sessions.');
         return 0;
       }
       const engagement = await dbClient.engagement.findUniqueOrThrow({ where: { id: engagementId } });
       return (await c2Service.sessions(engagement.userId, engagementId)).sessions.filter((s) => !s.isDead).length;
     },
     runtime: async (_actorId, engagementId) => {
       const engagement = await dbClient.engagement.findUniqueOrThrow({ where: { id: engagementId } });
       const bindings = await dbClient.engagementThread.findMany({ where: { engagementId } });
       if (bindings.length && !runsService) throw new TypeError('Runtime checkpoints are unavailable.');
       let pending = 0;
       for (const binding of bindings) {
         pending += (await runsService!.snapshot(engagement.userId, engagementId, binding.threadId)).pendingQuestions?.length ?? 0;
          pending += (await ownedRuns(engagement.userId, engagementId, binding.threadId)).filter((r) => ['pending', 'running'].includes(r.rawStatus)).length;
       }
       return pending;
     },
   }) : undefined;
     const scopeService = dbClient ? new ScopeService(dbClient) : undefined;
    plannerScope.confirm = scopeService?.confirmPlannerScope.bind(scopeService);
    // O06 (ADR-0083): persistent plan document drafts over the allowlisted
    // planning documents; requires both the DB (draft rows, audit) and the
    // workspace root (preconditioned reads/publish).
    const documentDrafts = dbClient && env.workspacePath ? new DocumentDraftService(dbClient, env.workspacePath) : undefined;
   const runtimeContext = runtimeConfig && runtime && projectsService && ownership && env.workspacePath
     ? new RuntimeContextService({
         config: runtimeConfig,
         projects: projectsService,
         ownership,
         workspaceRoot: env.workspacePath,
         runtime,
       }) : undefined;
   // W08: preflight readiness reports the actual runtime condition (agent
   // catalog availability) and never fails open when the dependency is
   // missing or unreachable. The assistant check is the catalog execution
   // role, reported separately from the runtime itself; the model fallback
   // chain is runtime-internal and is deliberately not claimed here.
   const runtimeReadiness = async (input: ReadinessInput): Promise<PreflightCheck[]> => {
     if (runtimeContext === undefined) return [{ id: 'runtime', state: 'unavailable', detail: 'The runtime is not configured in this deployment.' }];
     try {
       const graphs = (await runtimeContext.agents()).graphs;
       const executors = EXECUTION_ASSISTANTS.filter((g) => graphs.includes(g));
       const checks: PreflightCheck[] = [
         { id: 'runtime', state: graphs.length > 0 ? 'pass' : 'unavailable', detail: graphs.length > 0 ? null : 'The runtime exposes no agent graphs.' },
         { id: 'assistant', state: executors.length > 0 ? 'pass' : 'unavailable', detail: executors.length > 0 ? `Execution assistant graphs: ${executors.join(', ')}.` : 'The runtime exposes no execution assistant graph; operations cannot start.' },
       ];
       // W08: the selected thread's bound assistant must exist in the catalogue.
       if (dbClient !== undefined && input.threadId !== null) {
         const bound = await dbClient.engagementThread.findFirst({ where: { engagementId: input.engagementId, threadId: input.threadId }, select: { assistantId: true } });
         if (bound !== null && !graphs.includes(bound.assistantId)) {
           checks.push({ id: 'assistant-binding', state: 'unavailable', detail: `The selected thread is bound to assistant ${bound.assistantId}, which is not in the runtime catalogue.` });
         }
       }
       return checks;
     } catch (error) {
       return [{ id: 'runtime', state: 'unavailable', detail: error instanceof Error ? error.message : 'The runtime is unreachable.' }];
     }
   };
   const governanceService = dbClient && scopeService ? new GovernanceService(dbClient, scopeService, { readiness: runtimeReadiness }) : undefined;
   const runsService = ownership && runtimeContext && runtime && dbClient ? new RunService({ ownership, context: runtimeContext, runtime, reads: runtime,
     operations: {
       status: async (engagementId, threadId) => (await dbClient!.operationBinding.findFirst({ where: { engagementId, threadId }, orderBy: { createdAt: 'desc' }, select: { status: true } }))?.status ?? null,
       transition: async (engagementId, threadId, from, to) => (await dbClient!.operationBinding.updateMany({ where: { engagementId, threadId, status: { in: [...from] } }, data: { status: to, concurrencyVersion: { increment: 1 } } })).count > 0,
       uncertainRequests: (engagementId, threadId) => dbClient!.webRequestLedger.count({ where: { engagementId, threadId, state: 'uncertain' } }),
     },
     audit: async (actorId, engagementId, action, targetId, reason) => { await dbClient!.webAuditEntry.create({ data: { engagementId, actorId, action, targetType: 'thread', targetId, reason } }); },
     authorizeMutation: async (actorId, engagementId, kind, threadId) => {
     await requireEngagementAccess({ db: dbClient, actorId, multiUser: env.authMode === 'multi' }, engagementId, 'operator');
     await closureService!.assertOpen(engagementId);
     await governanceService!.assertNoActiveStop(engagementId, threadId);
     if (kind === 'execution' && threadId) await governanceService!.assertExecutionAuthorized(actorId, engagementId, threadId, env.authMode === 'multi');
    } }) : undefined;
   // W11 (ADR-0073): scheduled starts dispatch through the same run ledger and
   // re-run the identical execution gate a manual start runs.
   const scheduleService = dbClient && governanceService ? new ScheduleService(dbClient, {
     authorize: async (actorId, engagementId, threadId) => {
       await governanceService.assertExecutionAuthorized(actorId, engagementId, threadId, env.authMode === 'multi');
     },
     dispatch: runsService ? async (actorId, engagementId, threadId, requestId, reason) => {
       const view = await runsService.submit(actorId, engagementId, threadId, { requestId, message: reason });
       return view.runId ?? null;
     } : undefined,
   }, scopeService ?? undefined) : undefined;
    async function ownedRuns(actorId: string, engagementId: string, threadId: string): Promise<ScopedRunView[]> {
     if (!runsService) throw new TypeError('Runtime run reads are unavailable.');
     const runs: ScopedRunView[] = [];
     let offset = 0;
     while (offset < 1000) {
       const page = await runsService.listRuns(actorId, engagementId, threadId, { limit: '25', offset: String(offset) });
       runs.push(...page.runs);
       if (page.nextOffset === null) return runs;
       offset = page.nextOffset;
     }
     throw new TypeError('Runtime run inventory exceeds the bounded reconciliation limit.');
   }
  const fleetService = dbClient && runtimeContext && runsService ? new FleetService(dbClient, runtimeContext, runsService) : undefined;
  const findingsService = dbClient && env.workspacePath ? new FindingsService(dbClient, env.workspacePath) : undefined;
  const artifactsService = dbClient && env.workspacePath ? new ArtifactsService(dbClient, env.workspacePath) : undefined;
  const graphService = dbClient && env.graph ? new GraphService(dbClient, env.graph) : undefined;
  const libraryService = graphService && env.graph ? new LibraryService(graphService, env.graph) : undefined;
  const libraryReviewService = libraryService && dbClient ? new LibraryReviewService(dbClient, libraryService) : undefined;
  const timelineService = runsService && artifactsService && dbClient && env.workspacePath ? new TimelineService(dbClient, runsService, artifactsService, env.workspacePath) : undefined;
  const exportService = dbClient && env.workspacePath ? new ExportService(dbClient, env.workspacePath) : undefined;
  const settingsService = dbClient ? new SettingsService(dbClient, getLocalIdentity()) : undefined;
  const campaignsService = dbClient ? new CampaignService(dbClient, env.gophish ? new GoPhishClient(env.gophish) : undefined, env.evilginx ? new EvilginxClient(env.evilginx) : undefined) : undefined;
  const workspaceSettings = dbClient ? new WorkspaceSettingsService(dbClient, env.authMode === 'multi') : undefined;
   // W12: an approved C2 grant authorizes the session, never the target
   // landscape — every command dispatch also consumes the engagement's live
   // approved ROE revision, its time windows and the stop state.
   // The grant service and the C2 service reference each other; the provider is bound once the C2 service exists.
  let sessionProvider: { assertSessionReported(engagementId: string, sessionId: string): Promise<void> } | undefined;
  const c2Grants = dbClient ? new C2GrantsService(dbClient, workspaceSettings ? () => workspaceSettings.maxGrantHours() : undefined, scopeService && governanceService ? async (engagementId, target) => {
     const approved = await scopeService.latestApproved(engagementId);
     if (approved === null) throw new ProjectApiError(403, 'C2 commands require an approved scope revision for this engagement; complete the scope review first.');
     const roe = await scopeService.roeWindowAllows(engagementId, Date.now());
     if (!roe.ok) throw new ProjectApiError(403, roe.reason ?? 'Outside the approved ROE time windows.');
     await governanceService.assertNoActiveStop(engagementId, null);
     // W12: once the provider session address is known, it must map into the
     // approved effective scope — a grant never authorizes an out-of-scope target.
     if (target !== undefined) {
       const decision = await scopeService.targetInScope(engagementId, target);
       if (!decision.ok) throw new ProjectApiError(403, decision.reason ?? `Session target ${target} is outside the approved scope.`);
     }
   } : undefined, (engagementId, sessionId) => sessionProvider!.assertSessionReported(engagementId, sessionId)) : undefined;
  const auditService = dbClient ? new AuditService(dbClient) : undefined;
  const c2Service = dbClient ? new C2Service(dbClient, env.sliver ? new SliverClient(env.sliver) : undefined, c2Grants?.assertCommandAuthorized.bind(c2Grants)) : undefined;
  sessionProvider = c2Service;
  const vaultService = dbClient ? new VaultService(dbClient, env.vaultKey ?? null) : undefined;
  const membersService = dbClient ? new MembersService(dbClient, env.authMode === 'multi') : undefined;
  const inboxService = dbClient && governanceService ? new InboxService(dbClient, governanceService) : undefined;
  const findingsWorkflow = dbClient ? new FindingsWorkflowService(dbClient, artifactsService, libraryService) : undefined;
  const reportsService = dbClient ? new ReportsService(dbClient) : undefined;
  const app = await buildApp({
    deploymentId: env.deploymentId,
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
  libraryReviewService,
  inboxService,
  workspaceSettings,
  auditService,
  closureService,
  vaultService,
  membersService,
  scopeService,
  documentDrafts,
  governanceService,
  scheduleService,
  findingsWorkflow,
    reportsService,
    cancelRun: runsService ? async (threadId, runId, actorId, engagementId) => {
      const threads = threadId ? [{ threadId }] : (await runsService.listThreads(actorId, engagementId)).threads;
      let settled = true;
      for (const thread of threads) {
        const runs = await ownedRuns(actorId, engagementId, thread.threadId);
        for (const run of runs.filter((r) => !runId || r.runId === runId)) {
          if (!['pending', 'running'].includes(run.rawStatus)) continue;
          const stopped = await runsService.cancelRun(actorId, engagementId, thread.threadId, run.runId);
          if (['pending', 'running'].includes(stopped.rawStatus)) settled = false;
        }
      }
      return settled ? 'stopped' : 'acknowledged';
    } : undefined,
    hasActiveRuns: runsService ? async (actorId, engagementId) => {
      const { threads } = await runsService.listThreads(actorId, engagementId);
      for (const thread of threads) {
        const runs = await ownedRuns(actorId, engagementId, thread.threadId);
        if (runs.some((r) => ['pending', 'running'].includes(r.rawStatus))) return true;
      }
      return false;
    } : undefined,
  vaultKeyConfigured: env.vaultKey !== undefined,
  authMode: env.authMode,
   authDb: dbClient,
   workflowDb: dbClient,
  secureCookies: env.secureCookies,
  adminBootstrap: env.adminBootstrap,
  });
  if (env.authMode === 'multi' && dbClient && env.adminBootstrap) {
    await ensureBootstrapAdmin(dbClient, env.adminBootstrap.username, env.adminBootstrap.password, env.adminBootstrap.displayName);
  }

  // W11 worker: claims due schedule intents and dispatches them through the
  // runtime ledger. Server-side only — no browser timer ever controls this.
  let scheduleTimer: NodeJS.Timeout | undefined;
  if (scheduleService) {
    const workerId = randomUUID();
    scheduleTimer = setInterval(() => {
      void (async () => {
        await scheduleService.recoverStaleClaims(10 * 60 * 1000);
        const { claimed } = await scheduleService.claimDue(workerId);
        for (const intent of claimed) await scheduleService.runClaimed(intent);
      })().catch((error) => app.log.warn({ error }, 'schedule worker tick failed'));
    }, 15_000);
    scheduleTimer.unref();
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (closing) return;
    closing = true;
    if (scheduleTimer !== undefined) clearInterval(scheduleTimer);
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
