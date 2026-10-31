import { buildApp, type BuildAppOptions } from "../../src/app.js";
import { hashPassword } from "../../src/security/password.js";
import { FakeAiRoleStore } from "./fake-ai-role-store.js";
import { FakeAlertSubscriptionStore } from "./fake-alert-subscription-store.js";
import { FakeAppConfigStore } from "./fake-app-config-store.js";
import { FakeAssetStore } from "./fake-asset-store.js";
import { FakeAuditLogStore } from "./fake-audit-log-store.js";
import { FakeAuthStore } from "./fake-auth-store.js";
import { FakeBatchQueueStore } from "./fake-batch-queue-store.js";
import { FakeC2 } from "./fake-c2.js";
import { FakeConversationStore } from "./fake-conversation-store.js";
import { FakeExternalMcpStore } from "./fake-external-mcp-store.js";
import { FakeHiddenExecutionStore } from "./fake-hidden-execution-store.js";
import { FakeKnowledgeItemStore } from "./fake-knowledge-item-store.js";
import { FakeProjectStore } from "./fake-project-store.js";
import { FakeReadNotificationStore } from "./fake-read-notification-store.js";
import { FakeRecon } from "./fake-recon.js";
import { FakeRetrievalLogStore } from "./fake-retrieval-log-store.js";
import { FakeRuntime } from "./fake-runtime.js";
import { FakeSandbox } from "./fake-sandbox.js";
import { FakeToolGuardStore } from "./fake-tool-guard-store.js";
import { FakeVulnerabilityStore } from "./fake-vulnerability-store.js";
import { FakeWebShellStore } from "./fake-webshell-store.js";

/** Every store defaults to a fresh fake; pass `overrides` to swap one in (e.g. a specific FakeRuntime instance). */
export function buildTestAppOptions(overrides: Partial<BuildAppOptions> = {}): BuildAppOptions {
  return {
    authStore: new FakeAuthStore(),
    sessionDurationHours: 12,
    projectStore: new FakeProjectStore(),
    conversationStore: new FakeConversationStore(),
    runtime: new FakeRuntime(),
    assetStore: new FakeAssetStore(),
    vulnerabilityStore: new FakeVulnerabilityStore(),
    alertSubscriptionStore: new FakeAlertSubscriptionStore(),
    sandbox: new FakeSandbox(),
    batchQueueStore: new FakeBatchQueueStore(),
    webshellStore: new FakeWebShellStore(),
    c2: new FakeC2(),
    toolGuardStore: new FakeToolGuardStore(),
    knowledgeItemStore: new FakeKnowledgeItemStore(),
    retrievalLogStore: new FakeRetrievalLogStore(),
    recon: new FakeRecon(),
    appConfigStore: new FakeAppConfigStore(),
    externalMcpStore: new FakeExternalMcpStore(),
    hiddenExecutionStore: new FakeHiddenExecutionStore(),
    aiRoleStore: new FakeAiRoleStore(),
    auditLogStore: new FakeAuditLogStore(),
    readNotificationStore: new FakeReadNotificationStore(),
    ...overrides,
  };
}

/** Builds the app with a default FakeAuthStore operator ("admin"/"pw") already created, and logs in once. */
export async function buildAuthedTestApp(overrides: Partial<BuildAppOptions> = {}) {
  const authStore = (overrides.authStore as FakeAuthStore | undefined) ?? new FakeAuthStore();
  await authStore.createOperator({ username: "admin", displayName: "Operator", passwordHash: hashPassword("pw") });
  const options = buildTestAppOptions({ ...overrides, authStore });
  const app = buildApp(options);
  await app.ready();
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "pw" } });
  return { app, token: login.json().token as string, options };
}
