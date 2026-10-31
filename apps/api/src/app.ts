import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import type { C2Transport } from "./adapters/c2/client.js";
import type { RuntimeTransport } from "./adapters/runtime/client.js";
import type { SandboxFilesTransport } from "./adapters/sandbox/client.js";
import type { AlertSubscriptionStore } from "./db/alert-subscription-store.js";
import type { AssetStore } from "./db/asset-store.js";
import type { AuthStore } from "./db/auth-store.js";
import type { BatchQueueStore } from "./db/batch-queue-store.js";
import type { ConversationStore } from "./db/conversation-store.js";
import type { ProjectStore } from "./db/project-store.js";
import type { VulnerabilityStore } from "./db/vulnerability-store.js";
import type { WebShellStore } from "./db/webshell-store.js";
import { handleError } from "./http/error-handler.js";
import { registerAgentLoopRoutes } from "./http/routes/agent-loop.routes.js";
import { registerAssetRoutes } from "./http/routes/assets.routes.js";
import { registerAttackChainRoutes } from "./http/routes/attack-chains.routes.js";
import { registerAuthRoutes } from "./http/routes/auth.routes.js";
import { registerBatchTaskRoutes } from "./http/routes/batch-tasks.routes.js";
import { registerC2Routes } from "./http/routes/c2.routes.js";
import { registerConversationRoutes } from "./http/routes/conversations.routes.js";
import { registerFileRoutes } from "./http/routes/files.routes.js";
import { registerHealthRoutes } from "./http/routes/health.routes.js";
import { registerHitlRoutes } from "./http/routes/hitl.routes.js";
import { registerProjectRoutes } from "./http/routes/projects.routes.js";
import { registerStorageRoutes } from "./http/routes/storage.routes.js";
import { registerTerminalRoutes } from "./http/routes/terminal.routes.js";
import { registerVulnerabilityRoutes } from "./http/routes/vulnerabilities.routes.js";
import { registerWebShellRoutes } from "./http/routes/webshell.routes.js";

export interface BuildAppOptions {
  authStore: AuthStore;
  sessionDurationHours: number;
  projectStore: ProjectStore;
  conversationStore: ConversationStore;
  runtime: RuntimeTransport;
  assetStore: AssetStore;
  vulnerabilityStore: VulnerabilityStore;
  alertSubscriptionStore: AlertSubscriptionStore;
  sandbox: SandboxFilesTransport;
  batchQueueStore: BatchQueueStore;
  webshellStore: WebShellStore;
  c2: C2Transport;
  agentSyncWaitMs?: number;
  defaultAssistantId?: string;
  batchTaskWaitMs?: number;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.decorateRequest("operator", undefined);
  app.setErrorHandler(handleError);
  app.register(multipart);

  registerHealthRoutes(app);
  registerAuthRoutes(app, { store: options.authStore, sessionDurationHours: options.sessionDurationHours });
  registerProjectRoutes(app, {
    authStore: options.authStore,
    projectStore: options.projectStore,
    conversationStore: options.conversationStore,
  });
  registerConversationRoutes(app, {
    authStore: options.authStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
  });
  registerAgentLoopRoutes(app, {
    authStore: options.authStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
    syncWaitMs: options.agentSyncWaitMs,
    defaultAssistantId: options.defaultAssistantId,
  });
  registerHitlRoutes(app, { authStore: options.authStore });
  registerAssetRoutes(app, { authStore: options.authStore, assetStore: options.assetStore });
  registerVulnerabilityRoutes(app, {
    authStore: options.authStore,
    vulnerabilityStore: options.vulnerabilityStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
    alertSubscriptionStore: options.alertSubscriptionStore,
  });
  registerAttackChainRoutes(app, { authStore: options.authStore });
  registerFileRoutes(app, {
    authStore: options.authStore,
    projectStore: options.projectStore,
    conversationStore: options.conversationStore,
    sandbox: options.sandbox,
  });
  registerStorageRoutes(app, { authStore: options.authStore });
  registerBatchTaskRoutes(app, {
    authStore: options.authStore,
    batchQueueStore: options.batchQueueStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
    defaultAssistantId: options.defaultAssistantId,
    taskWaitMs: options.batchTaskWaitMs,
  });
  registerWebShellRoutes(app, {
    authStore: options.authStore,
    webshellStore: options.webshellStore,
    conversationStore: options.conversationStore,
  });
  registerC2Routes(app, { authStore: options.authStore, c2: options.c2 });
  registerTerminalRoutes(app, { authStore: options.authStore });

  return app;
}
