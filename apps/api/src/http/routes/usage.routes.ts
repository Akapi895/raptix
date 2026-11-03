import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface UsageRoutesOptions {
  authStore: AuthStore;
}

/**
 * Real per-model token accounting would need LiteLLM's own spend-tracking
 * API (general_settings.database_url is set in infra/config/litellm.yaml,
 * so LiteLLM itself does track this) -- but its exact /spend/logs response
 * schema isn't reliably documented, and there is no running LiteLLM
 * instance in this dev environment to verify it against empirically,
 * unlike this repo's own internal patterns which can be read from source.
 * Guessing a third-party wire format here risks silently reporting wrong
 * token/cost numbers, which is worse than refusing. Stub honestly instead.
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerUsageRoutes(app: FastifyInstance, options: UsageRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  app.get("/api/usage/tokens", { preHandler: requireSession }, notImplementedForThisDeployment);
}
