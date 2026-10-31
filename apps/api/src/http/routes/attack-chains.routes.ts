import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface AttackChainRoutesOptions {
  authStore: AuthStore;
}

/**
 * An attack chain is a derived summary of a conversation's transcript (which
 * steps led to which finding), not a stored record -- CyberStrikeAI's Go
 * backend generates it on demand via its own LLM call over the transcript.
 * Raptix has no equivalent dedicated summarization capability wired into
 * apps/api yet: this needs a prompt + a call through `intelligence/llm`'s
 * model factory, which is Tier 5 territory (Configuration and AI models),
 * not a data-CRUD concern like the rest of Tier 3. Stub honestly rather
 * than return the raw transcript relabeled as a "chain".
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerAttackChainRoutes(app: FastifyInstance, options: AttackChainRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);

  for (const [method, path] of [
    ["GET", "/api/attack-chain/:conversationId"],
    ["POST", "/api/attack-chain/:conversationId/regenerate"],
    ["GET", "/api/conversations/:id/attack-chain"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}
