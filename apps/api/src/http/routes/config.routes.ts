import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfigStore } from "../../db/app-config-store.js";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface ConfigRoutesOptions {
  authStore: AuthStore;
  appConfigStore: AppConfigStore;
  fetchImpl?: typeof fetch;
}

const CONFIG_KEY = "ai";

/**
 * Pushing a saved config live into the running LiteLLM/runtime stack is
 * stubbed on purpose: infra/config/litellm.yaml pins
 * `store_model_in_db: false`, a deliberate upstream choice that there is no
 * live admin API apps/api could call to defeat. What's saved here is real
 * (GET/POST/PUT below persist faithfully), but "apply" would be theater --
 * actually changing which model the agent uses needs an env var / YAML
 * edit and a container restart, not an HTTP call.
 */
async function applyNotImplemented(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

/**
 * Raptix's tool catalog (~159 @tool-decorated functions across
 * execution/tools/<domain>/, docs/architecture/tool-classification.md) has
 * no HTTP introspection endpoint to enumerate or toggle -- hardcoding a
 * copy here would drift from the real catalog silently. Stub honestly
 * rather than let an operator "disable" a tool name apps/api can't verify
 * exists, or miss real ones.
 */
async function toolsNotImplemented(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function testOpenAiCompatible(
  fetchImpl: typeof fetch,
  body: { base_url?: string; api_key?: string; model?: string },
  vision: boolean,
): Promise<Record<string, unknown>> {
  if (!body.base_url || !body.api_key || !body.model) {
    return { success: false, error: "base_url, api_key and model are required" };
  }
  const started = Date.now();
  try {
    const content = vision
      ? [
          { type: "text", text: "describe this image in one word" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" } },
        ]
      : "ping";
    const response = await fetchImpl(`${trimBase(body.base_url)}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.api_key}` },
      body: JSON.stringify({ model: body.model, messages: [{ role: "user", content }], max_tokens: 8 }),
    });
    const latency_ms = Date.now() - started;
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as { error?: { message?: string } | string };
      const message = typeof errorBody.error === "string" ? errorBody.error : errorBody.error?.message;
      return { success: false, error: message ?? `HTTP ${response.status}`, latency_ms };
    }
    return vision ? { success: true, supported: true, model: body.model, latency_ms } : { success: true, model: body.model, latency_ms };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerConfigRoutes(app: FastifyInstance, options: ConfigRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { appConfigStore } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  app.get("/api/config", { preHandler: requireSession }, async () => {
    const config = await appConfigStore.get(CONFIG_KEY);
    return config ?? {};
  });

  app.post("/api/config", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const body = (request.body as Record<string, unknown>) ?? {};
    return appConfigStore.set(CONFIG_KEY, body);
  });

  app.put("/api/config", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const body = (request.body as Record<string, unknown>) ?? {};
    return appConfigStore.set(CONFIG_KEY, body);
  });

  app.post("/api/config/apply", { preHandler: requireSession }, applyNotImplemented);

  app.post("/api/config/list-models", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const body = request.body as { base_url?: string; api_key?: string } | undefined;
    if (!body?.base_url || !body.api_key) return { success: false, error: "base_url and api_key are required", models: [] };
    try {
      const response = await fetchImpl(`${trimBase(body.base_url)}/models`, { headers: { Authorization: `Bearer ${body.api_key}` } });
      if (!response.ok) return { success: false, error: `HTTP ${response.status}`, models: [] };
      const parsed = (await response.json().catch(() => ({}))) as { data?: { id?: string }[] };
      const models = (parsed.data ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === "string");
      return { success: true, models, count: models.length };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error), models: [] };
    }
  });

  app.post("/api/config/test-openai", { preHandler: requireSession }, async (request: FastifyRequest) => {
    return testOpenAiCompatible(fetchImpl, (request.body as Record<string, unknown>) ?? {}, false);
  });

  app.post("/api/config/test-vision", { preHandler: requireSession }, async (request: FastifyRequest) => {
    return testOpenAiCompatible(fetchImpl, (request.body as Record<string, unknown>) ?? {}, true);
  });

  // TypeSafe/Jev is a third-party HITL-audit protocol (apps/ui-app's
  // AuditBackend union, hitl/model.ts) with no documented wire format
  // anywhere in this repo. Guessing its request/response shape would risk
  // reporting a false "connection successful" for a service apps/api can't
  // actually verify against -- stub honestly instead.
  app.post("/api/config/test-typesafe", { preHandler: requireSession }, async (_request: unknown, reply: FastifyReply) => {
    await reply.code(501).send({ error: "Not implemented for this deployment" });
  });

  app.get("/api/config/tools", { preHandler: requireSession }, toolsNotImplemented);
  app.put("/api/config/tools", { preHandler: requireSession }, toolsNotImplemented);
  app.get("/api/config/tools/:name/schema", { preHandler: requireSession }, toolsNotImplemented);
}
