import type { FastifyInstance } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { AttackChainService } from "../../services/attack-chain.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface AttackChainRoutesOptions {
  authStore: AuthStore;
  attackChainService: AttackChainService;
}

/**
 * An attack chain is a derived summary of a conversation's transcript (which
 * steps led to which finding): one LLM call over the live thread's messages,
 * exactly what CyberStrikeAI's Go backend did. apps/ui-app's chain flow
 * renders the JSON response of BOTH endpoints directly and retries on 409,
 * which this service raises while a derivation for the same conversation is
 * already running -- there is no background queue, the HTTP request does the
 * work. Unconfigured/no-reachable model and unusable model output surface as
 * 503/502 (via the global error handler), never a fabricated chain.
 */
export function registerAttackChainRoutes(app: FastifyInstance, options: AttackChainRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { attackChainService } = options;

  for (const path of ["/api/attack-chain/:conversationId", "/api/conversations/:id/attack-chain"] as const) {
    app.get(path, { preHandler: requireSession }, async (request, reply) => {
      const params = request.params as Record<string, string>;
      const chain = await attackChainService.get(params.conversationId ?? params.id);
      await reply.send(chain);
    });
  }

  app.post("/api/attack-chain/:conversationId/regenerate", { preHandler: requireSession }, async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const chain = await attackChainService.get(conversationId, true);
    await reply.send(chain);
  });
}
