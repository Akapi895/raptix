import { buildApp } from "./app.js";
import { C2BridgeClient, UnconfiguredC2Client } from "./adapters/c2/client.js";
import { loadC2BridgeConfig } from "./adapters/c2/token.js";
import { loadReconProviderConfig } from "./adapters/recon/config.js";
import { ReconProvidersClient } from "./adapters/recon/client.js";
import { RuntimeClient } from "./adapters/runtime/client.js";
import { loadRuntimeApiToken } from "./adapters/runtime/token.js";
import { SandboxFilesClient, UnconfiguredSandboxFilesClient } from "./adapters/sandbox/client.js";
import { loadSandboxKey } from "./adapters/sandbox/token.js";
import { loadEnv } from "./config/env.js";
import { createDbClient, disconnectDb } from "./db/client.js";
import { PrismaAlertSubscriptionStore } from "./db/alert-subscription-store.js";
import { PrismaAppConfigStore } from "./db/app-config-store.js";
import { PrismaAssetStore } from "./db/asset-store.js";
import { PrismaAuthStore } from "./db/auth-store.js";
import { PrismaBatchQueueStore } from "./db/batch-queue-store.js";
import { PrismaConversationStore } from "./db/conversation-store.js";
import { PrismaExternalMcpStore } from "./db/external-mcp-store.js";
import { PrismaHiddenExecutionStore } from "./db/hidden-execution-store.js";
import { PrismaKnowledgeItemStore } from "./db/knowledge-item-store.js";
import { PrismaProjectStore } from "./db/project-store.js";
import { PrismaRetrievalLogStore } from "./db/retrieval-log-store.js";
import { PrismaToolGuardStore } from "./db/tool-guard-store.js";
import { PrismaVulnerabilityStore } from "./db/vulnerability-store.js";
import { PrismaWebShellStore } from "./db/webshell-store.js";
import { ensureOperatorSeeded } from "./security/operator-bootstrap.js";

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const db = createDbClient({ connectionString: env.databaseUrl });
  const authStore = new PrismaAuthStore(db);
  const projectStore = new PrismaProjectStore(db);
  const conversationStore = new PrismaConversationStore(db);
  const assetStore = new PrismaAssetStore(db);
  const vulnerabilityStore = new PrismaVulnerabilityStore(db);
  const alertSubscriptionStore = new PrismaAlertSubscriptionStore(db);
  const batchQueueStore = new PrismaBatchQueueStore(db);
  const webshellStore = new PrismaWebShellStore(db);
  const toolGuardStore = new PrismaToolGuardStore(db);
  const knowledgeItemStore = new PrismaKnowledgeItemStore(db);
  const retrievalLogStore = new PrismaRetrievalLogStore(db);
  const appConfigStore = new PrismaAppConfigStore(db);
  const externalMcpStore = new PrismaExternalMcpStore(db);
  const hiddenExecutionStore = new PrismaHiddenExecutionStore(db);
  const recon = new ReconProvidersClient(loadReconProviderConfig(process.env));

  const seed = await ensureOperatorSeeded(authStore, {
    operatorUsername: env.operatorUsername,
    operatorPassword: env.operatorPassword,
  });
  if (seed.seeded) {
    if (seed.generatedPassword) {
      console.warn(
        `[apps/api] Seeded operator "${seed.username}" with a generated password: ${seed.generatedPassword}\n` +
          "[apps/api] Set RAPTIX_API_OPERATOR_PASSWORD to pin this instead, and change it via POST /api/auth/change-password.",
      );
    } else {
      console.warn(`[apps/api] Seeded operator "${seed.username}" from RAPTIX_API_OPERATOR_PASSWORD.`);
    }
  }

  // Load-bearing for every Tier 2 route (chat, tasks, cancel). A failure
  // here does not block apps/api from serving auth, but is worth surfacing
  // loudly since nothing downstream will work until it's reachable.
  const runtimeToken = loadRuntimeApiToken(env.runtimeApiTokenFile);
  const runtime = new RuntimeClient({ apiUrl: env.langgraphApiUrl, apiToken: runtimeToken });
  try {
    const info = await runtime.ping();
    console.info(`[apps/api] Runtime reachable at ${env.langgraphApiUrl} (version ${info.version}, graphs: ${info.graphIds.join(", ") || "none"})`);
  } catch (error) {
    console.warn(
      `[apps/api] Runtime not reachable at ${env.langgraphApiUrl} -- auth works, but every Tier 2+ route will fail until it is. (${(error as Error).message})`,
    );
  }

  // Load-bearing for Tier 3's Files routes (ADR-0102: project files only
  // through the project sandbox). Nothing provisions a sandbox per
  // apps/api Project yet, so this is expected to be unreachable until that
  // exists -- Files routes fail 503 honestly rather than a fake success.
  let sandboxKey: string | undefined;
  try {
    sandboxKey = loadSandboxKey(env.sandboxKeyFile);
  } catch (error) {
    console.warn(`[apps/api] RAPTIX_SANDBOX_KEY_FILE invalid, Files routes will fail 503. (${(error as Error).message})`);
  }
  const sandbox = sandboxKey ? new SandboxFilesClient(sandboxKey) : new UnconfiguredSandboxFilesClient();
  if (!sandboxKey) {
    console.warn("[apps/api] RAPTIX_SANDBOX_KEY_FILE not set -- Files routes will fail 503 until it is.");
  }

  // Load-bearing for Tier 4's C2 read routes. Optional, like the sandbox key -- most C2
  // ops are stubbed regardless (see c2.routes.ts), so this only affects session/listener/
  // profile listing.
  let c2Config: ReturnType<typeof loadC2BridgeConfig>;
  try {
    c2Config = loadC2BridgeConfig(env.sliverBridgeUrl, env.sliverBridgeToken);
  } catch (error) {
    console.warn(`[apps/api] SLIVER_BRIDGE_URL/_TOKEN invalid, C2 read routes will fail 503. (${(error as Error).message})`);
  }
  const c2 = c2Config ? new C2BridgeClient(c2Config) : new UnconfiguredC2Client();
  if (!c2Config) {
    console.warn("[apps/api] SLIVER_BRIDGE_URL/_TOKEN not set -- C2 read routes will fail 503 until they are.");
  }

  const app = buildApp({
    authStore,
    sessionDurationHours: env.sessionDurationHours,
    projectStore,
    conversationStore,
    runtime,
    assetStore,
    vulnerabilityStore,
    alertSubscriptionStore,
    sandbox,
    batchQueueStore,
    webshellStore,
    c2,
    toolGuardStore,
    knowledgeItemStore,
    retrievalLogStore,
    recon,
    appConfigStore,
    externalMcpStore,
    hiddenExecutionStore,
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await disconnectDb(db);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await app.listen({ port: env.port, host: env.host });
  } catch (error) {
    app.log.error(error);
    await disconnectDb(db);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
