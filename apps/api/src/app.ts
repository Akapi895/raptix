import Fastify, { type FastifyInstance } from "fastify";
import type { RuntimeTransport } from "./adapters/runtime/client.js";
import type { AuthStore } from "./db/auth-store.js";
import type { ConversationStore } from "./db/conversation-store.js";
import type { ProjectStore } from "./db/project-store.js";
import { handleError } from "./http/error-handler.js";
import { registerAgentLoopRoutes } from "./http/routes/agent-loop.routes.js";
import { registerAuthRoutes } from "./http/routes/auth.routes.js";
import { registerConversationRoutes } from "./http/routes/conversations.routes.js";
import { registerHealthRoutes } from "./http/routes/health.routes.js";
import { registerHitlRoutes } from "./http/routes/hitl.routes.js";
import { registerProjectRoutes } from "./http/routes/projects.routes.js";

export interface BuildAppOptions {
  authStore: AuthStore;
  sessionDurationHours: number;
  projectStore: ProjectStore;
  conversationStore: ConversationStore;
  runtime: RuntimeTransport;
  agentSyncWaitMs?: number;
  defaultAssistantId?: string;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.decorateRequest("operator", undefined);
  app.setErrorHandler(handleError);

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

  return app;
}
