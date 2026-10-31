import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import type { RuntimeTransport } from "./adapters/runtime/client.js";
import type { SandboxFilesTransport } from "./adapters/sandbox/client.js";
import type { AlertSubscriptionStore } from "./db/alert-subscription-store.js";
import type { AssetStore } from "./db/asset-store.js";
import type { AuthStore } from "./db/auth-store.js";
import type { ConversationStore } from "./db/conversation-store.js";
import type { ProjectStore } from "./db/project-store.js";
import type { VulnerabilityStore } from "./db/vulnerability-store.js";
import { handleError } from "./http/error-handler.js";
import { registerAgentLoopRoutes } from "./http/routes/agent-loop.routes.js";
import { registerAssetRoutes } from "./http/routes/assets.routes.js";
import { registerAttackChainRoutes } from "./http/routes/attack-chains.routes.js";
import { registerAuthRoutes } from "./http/routes/auth.routes.js";
import { registerConversationRoutes } from "./http/routes/conversations.routes.js";
import { registerFileRoutes } from "./http/routes/files.routes.js";
import { registerHealthRoutes } from "./http/routes/health.routes.js";
import { registerHitlRoutes } from "./http/routes/hitl.routes.js";
import { registerProjectRoutes } from "./http/routes/projects.routes.js";
import { registerStorageRoutes } from "./http/routes/storage.routes.js";
import { registerVulnerabilityRoutes } from "./http/routes/vulnerabilities.routes.js";

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
  agentSyncWaitMs?: number;
  defaultAssistantId?: string;
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

  return app;
}
