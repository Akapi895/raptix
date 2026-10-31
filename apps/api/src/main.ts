import { buildApp } from "./app.js";
import { RuntimeClient } from "./adapters/runtime/client.js";
import { loadRuntimeApiToken } from "./adapters/runtime/token.js";
import { loadEnv } from "./config/env.js";
import { createDbClient, disconnectDb } from "./db/client.js";
import { PrismaAuthStore } from "./db/auth-store.js";
import { PrismaConversationStore } from "./db/conversation-store.js";
import { PrismaProjectStore } from "./db/project-store.js";
import { ensureOperatorSeeded } from "./security/operator-bootstrap.js";

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const db = createDbClient({ connectionString: env.databaseUrl });
  const authStore = new PrismaAuthStore(db);
  const projectStore = new PrismaProjectStore(db);
  const conversationStore = new PrismaConversationStore(db);

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

  const app = buildApp({
    authStore,
    sessionDurationHours: env.sessionDurationHours,
    projectStore,
    conversationStore,
    runtime,
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
