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
  // location — never a default, never derived from request input.
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
  const runtimeContext = runtimeConfig && runtime && projectsService && ownership && env.workspacePath
    ? new RuntimeContextService({ config: runtimeConfig, projects: projectsService, ownership, workspaceRoot: env.workspacePath, runtime }) : undefined;
  const runsService = ownership && runtimeContext && runtime ? new RunService({ ownership, context: runtimeContext, runtime, reads: runtime }) : undefined;
  const approvalsService = dbClient && projectsService && env.workspacePath ? new ApprovalsService(dbClient, env.workspacePath) : undefined;
  const findingsService = dbClient && env.workspacePath ? new FindingsService(dbClient, env.workspacePath) : undefined;
  const artifactsService = dbClient && env.workspacePath ? new ArtifactsService(dbClient, env.workspacePath) : undefined;
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
  });

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
