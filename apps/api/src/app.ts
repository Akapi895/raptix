import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import type { C2Transport } from "./adapters/c2/client.js";
import type { LlmClient } from "./adapters/llm/client.js";
import type { ReconProvidersTransport } from "./adapters/recon/client.js";
import type { RuntimeTransport } from "./adapters/runtime/client.js";
import type { SandboxFilesTransport } from "./adapters/sandbox/client.js";
import type { SandboxProvisioner } from "./adapters/sandbox/controller.js";
import type { FactStore } from "./db/fact-store.js";
import { AttackChainService } from "./services/attack-chain.js";
import type { AiRoleStore } from "./db/ai-role-store.js";
import type { AlertSubscriptionStore } from "./db/alert-subscription-store.js";
import type { AppConfigStore } from "./db/app-config-store.js";
import type { AssetStore } from "./db/asset-store.js";
import type { AuditLogStore } from "./db/audit-log-store.js";
import type { AuthStore } from "./db/auth-store.js";
import type { BatchQueueStore } from "./db/batch-queue-store.js";
import type { ConversationStore } from "./db/conversation-store.js";
import type { ExternalMcpStore } from "./db/external-mcp-store.js";
import type { HiddenExecutionStore } from "./db/hidden-execution-store.js";
import type { KnowledgeItemStore } from "./db/knowledge-item-store.js";
import type { MarkdownAgentStore } from "./db/markdown-agent-store.js";
import type { ProjectStore } from "./db/project-store.js";
import type { ReadNotificationStore } from "./db/read-notification-store.js";
import type { RetrievalLogStore } from "./db/retrieval-log-store.js";
import type { ToolGuardStore } from "./db/tool-guard-store.js";
import type { VulnerabilityStore } from "./db/vulnerability-store.js";
import type { WebShellStore } from "./db/webshell-store.js";
import type { WorkflowStore } from "./db/workflow-store.js";
import { handleError } from "./http/error-handler.js";
import { registerAgentLoopRoutes } from "./http/routes/agent-loop.routes.js";
import { registerAssetRoutes } from "./http/routes/assets.routes.js";
import { registerAttackChainRoutes } from "./http/routes/attack-chains.routes.js";
import { registerAuditRoutes } from "./http/routes/audit.routes.js";
import { registerAuthRoutes } from "./http/routes/auth.routes.js";
import { registerBatchTaskRoutes } from "./http/routes/batch-tasks.routes.js";
import { registerC2Routes } from "./http/routes/c2.routes.js";
import { registerConfigRoutes } from "./http/routes/config.routes.js";
import { registerConversationRoutes } from "./http/routes/conversations.routes.js";
import { registerExternalMcpRoutes } from "./http/routes/external-mcp.routes.js";
import { registerFileRoutes } from "./http/routes/files.routes.js";
import { registerFofaRoutes } from "./http/routes/fofa.routes.js";
import { registerHealthRoutes } from "./http/routes/health.routes.js";
import { registerHitlRoutes } from "./http/routes/hitl.routes.js";
import { registerKnowledgeRoutes } from "./http/routes/knowledge.routes.js";
import { registerMarkdownAgentRoutes } from "./http/routes/markdown-agents.routes.js";
import { registerMcpRoutes } from "./http/routes/mcp.routes.js";
import { registerMonitorRoutes } from "./http/routes/monitor.routes.js";
import { registerNotificationRoutes } from "./http/routes/notifications.routes.js";
import { registerOpenApiRoutes } from "./http/routes/openapi.routes.js";
import { registerProjectRoutes } from "./http/routes/projects.routes.js";
import { registerRolesRoutes } from "./http/routes/roles.routes.js";
import { registerSkillsRoutes } from "./http/routes/skills.routes.js";
import { registerSpecialistsRoutes } from "./http/routes/specialists.routes.js";
import { registerSpecialistConfigurationRoutes } from "./http/routes/specialist-configuration.routes.js";
import { SpecialistConfigurationService } from "./services/specialist-configuration.js";
import { ToolCatalogService } from "./services/tool-catalog.js";
import type { SkillsCorpus } from "./adapters/skills/corpus.js";
import type { KnowledgeGraph } from "./adapters/knowledge-graph/client.js";
import type { MessageEventStore } from "./db/message-event-store.js";
import { registerStorageRoutes } from "./http/routes/storage.routes.js";
import { registerTerminalRoutes } from "./http/routes/terminal.routes.js";
import { registerToolGuardRoutes } from "./http/routes/tool-guard.routes.js";
import { registerUsageRoutes } from "./http/routes/usage.routes.js";
import { registerVulnerabilityRoutes } from "./http/routes/vulnerabilities.routes.js";
import { registerWebShellRoutes } from "./http/routes/webshell.routes.js";
import { registerWorkflowRoutes } from "./http/routes/workflows.routes.js";

export interface BuildAppOptions {
  authStore: AuthStore;
  sessionDurationHours: number;
  projectStore: ProjectStore;
  conversationStore: ConversationStore;
  factStore: FactStore;
  assetStore: AssetStore;
  vulnerabilityStore: VulnerabilityStore;
  runtime: RuntimeTransport;
  llm: LlmClient;
  alertSubscriptionStore: AlertSubscriptionStore;
  sandbox: SandboxFilesTransport;
  sandboxProvisioner: SandboxProvisioner;
  batchQueueStore: BatchQueueStore;
  webshellStore: WebShellStore;
  c2: C2Transport;
  toolGuardStore: ToolGuardStore;
  knowledgeItemStore: KnowledgeItemStore;
  retrievalLogStore: RetrievalLogStore;
  recon: ReconProvidersTransport;
  appConfigStore: AppConfigStore;
  externalMcpStore: ExternalMcpStore;
  hiddenExecutionStore: HiddenExecutionStore;
  aiRoleStore: AiRoleStore;
  auditLogStore: AuditLogStore;
  readNotificationStore: ReadNotificationStore;
  markdownAgentStore: MarkdownAgentStore;
  workflowStore: WorkflowStore;
  skillsCorpus: SkillsCorpus;
  knowledgeGraph: KnowledgeGraph;
  messageEventStore: MessageEventStore;
  openApiSpecPath?: string;
  agentSyncWaitMs?: number;
  defaultAssistantId?: string;
  sandboxKey?: string;
  batchTaskWaitMs?: number;
  /** Resolves the AI channel for apps/api's own derivations (attack chains) from the "ai" config. */
  resolveLlmChannel: () => Promise<{ baseUrl: string; apiKey: string; model: string } | null>;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });
  const specialistConfiguration = new SpecialistConfigurationService(options.appConfigStore, options.runtime);
  const toolCatalog = new ToolCatalogService(options.runtime);

  const attackChainService = new AttackChainService(options.conversationStore, options.runtime, options.llm, options.resolveLlmChannel);

  app.decorateRequest("operator", undefined);
  app.setErrorHandler(handleError);
  app.register(multipart);

  registerHealthRoutes(app);
  registerAuthRoutes(app, {
    store: options.authStore,
    sessionDurationHours: options.sessionDurationHours,
    auditLogStore: options.auditLogStore,
  });
  registerProjectRoutes(app, {
    authStore: options.authStore,
    projectStore: options.projectStore,
    conversationStore: options.conversationStore,
    factStore: options.factStore,
    assetStore: options.assetStore,
    vulnerabilityStore: options.vulnerabilityStore,
    attackChainService,
    sandboxProvisioner: options.sandboxProvisioner,
  });
  registerConversationRoutes(app, {
    authStore: options.authStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
    projectStore: options.projectStore,
    sandbox: options.sandbox,
    messageEventStore: options.messageEventStore,
  });
  registerAgentLoopRoutes(app, {
    specialistConfiguration,
    authStore: options.authStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
    syncWaitMs: options.agentSyncWaitMs,
    projectStore: options.projectStore,
    sandboxKey: options.sandboxKey,
    defaultAssistantId: options.defaultAssistantId,
    messageEventStore: options.messageEventStore,
  });
  registerHitlRoutes(app, { authStore: options.authStore, projectStore: options.projectStore, sandbox: options.sandbox });
  registerAssetRoutes(app, { authStore: options.authStore, assetStore: options.assetStore, projectStore: options.projectStore, knowledgeGraph: options.knowledgeGraph });
  registerVulnerabilityRoutes(app, {
    authStore: options.authStore,
    vulnerabilityStore: options.vulnerabilityStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
    alertSubscriptionStore: options.alertSubscriptionStore,
    projectStore: options.projectStore,
    sandbox: options.sandbox,
  });
  registerAttackChainRoutes(app, { authStore: options.authStore, attackChainService });
  registerFileRoutes(app, {
    authStore: options.authStore,
    projectStore: options.projectStore,
    conversationStore: options.conversationStore,
    sandbox: options.sandbox,
  });
  registerStorageRoutes(app, { authStore: options.authStore });
  registerBatchTaskRoutes(app, {
    specialistConfiguration,
    authStore: options.authStore,
    batchQueueStore: options.batchQueueStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
    projectStore: options.projectStore,
    sandboxKey: options.sandboxKey,
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
  registerToolGuardRoutes(app, { authStore: options.authStore, toolGuardStore: options.toolGuardStore });
  registerKnowledgeRoutes(app, {
    authStore: options.authStore,
    knowledgeItemStore: options.knowledgeItemStore,
    retrievalLogStore: options.retrievalLogStore,
  });
  registerSkillsRoutes(app, { authStore: options.authStore, corpus: options.skillsCorpus });
  registerFofaRoutes(app, { authStore: options.authStore, recon: options.recon });
  registerConfigRoutes(app, { authStore: options.authStore, appConfigStore: options.appConfigStore, c2: options.c2, toolCatalog });
  registerExternalMcpRoutes(app, { authStore: options.authStore, externalMcpStore: options.externalMcpStore });
  registerMonitorRoutes(app, {
    authStore: options.authStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
    hiddenExecutionStore: options.hiddenExecutionStore,
  });
  registerMcpRoutes(app, {
    authStore: options.authStore,
    conversationStore: options.conversationStore,
    runtime: options.runtime,
    externalMcpStore: options.externalMcpStore,
  });
  registerRolesRoutes(app, { authStore: options.authStore, aiRoleStore: options.aiRoleStore });
  registerSpecialistsRoutes(app, { authStore: options.authStore, runtime: options.runtime });
  registerSpecialistConfigurationRoutes(app, { authStore: options.authStore, runtime: options.runtime, projectStore: options.projectStore, configuration: specialistConfiguration });
  registerAuditRoutes(app, { authStore: options.authStore, auditLogStore: options.auditLogStore });
  registerNotificationRoutes(app, {
    authStore: options.authStore,
    vulnerabilityStore: options.vulnerabilityStore,
    readNotificationStore: options.readNotificationStore,
  });
  registerUsageRoutes(app, { authStore: options.authStore });
  registerOpenApiRoutes(app, { authStore: options.authStore, specPath: options.openApiSpecPath });
  registerMarkdownAgentRoutes(app, { authStore: options.authStore, markdownAgentStore: options.markdownAgentStore });
  registerWorkflowRoutes(app, { authStore: options.authStore, workflowStore: options.workflowStore });

  return app;
}
