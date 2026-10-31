import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface StorageRoutesOptions {
  authStore: AuthStore;
}

/**
 * CyberStrikeAI's "storage" is a server-wide local-disk retention policy
 * (internal/storage/{category,cleaner,usage}.go): categories like
 * "workspace"/"tool_outputs" spanning every project, cleaned on a timer.
 * Raptix has no equivalent: project files live only in each project's own
 * sandbox (ADR-0102), not on apps/api's local disk, and there is no runtime
 * endpoint for a global disk-cleanup policy -- the launcher/Docker manage
 * sandbox volume lifecycle, not a runtime HTTP API. Stub rather than invent
 * a fake policy apps/api doesn't actually enforce.
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerStorageRoutes(app: FastifyInstance, options: StorageRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);

  for (const [method, path] of [
    ["GET", "/api/storage/meta"],
    ["GET", "/api/storage/status"],
    ["POST", "/api/storage/cleanup"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}
