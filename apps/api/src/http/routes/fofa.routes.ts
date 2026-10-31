import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ReconProvider, ReconProvidersTransport } from "../../adapters/recon/client.js";
import { ReconProviderRejectedError, ReconProviderUnconfiguredError } from "../../adapters/recon/errors.js";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface FofaRoutesOptions {
  authStore: AuthStore;
  recon: ReconProvidersTransport;
}

const PROVIDERS = new Set<ReconProvider>(["fofa", "zoomeye", "quake", "shodan"]);

/**
 * Natural-language-to-query-DSL parsing needs an LLM call; apps/api has no
 * direct LiteLLM chat-completion client (every LLM-backed thing so far goes
 * through the Python runtime's LangGraph thread/run abstraction, Tier 2).
 * Building a new direct HTTP client to LiteLLM for this one convenience
 * endpoint is reasonable future work, not done this pass -- the search
 * itself (this file's other route) is the feature's real value.
 */
async function parseNotImplemented(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerFofaRoutes(app: FastifyInstance, options: FofaRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { recon } = options;

  app.post("/api/fofa/search", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { provider?: string; query?: string; size?: number; page?: number; fields?: string; full?: boolean } | undefined;
    const provider = (body?.provider ?? "fofa") as ReconProvider;
    if (!body?.query || !PROVIDERS.has(provider)) {
      await reply.code(400).send({ error: "query is required and provider must be one of fofa, zoomeye, quake, shodan" });
      return;
    }
    try {
      return await recon.search({
        provider,
        query: body.query,
        size: Math.max(1, body.size ?? 100),
        page: Math.max(1, body.page ?? 1),
        fields: body.fields ?? "",
        full: body.full === true,
      });
    } catch (error) {
      if (error instanceof ReconProviderUnconfiguredError) {
        await reply.code(503).send({ error: error.message });
        return;
      }
      if (error instanceof ReconProviderRejectedError) {
        await reply.code(502).send({ error: error.message });
        return;
      }
      throw error;
    }
  });

  app.post("/api/fofa/parse", { preHandler: requireSession }, parseNotImplemented);
}
