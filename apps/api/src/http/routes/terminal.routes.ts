import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface TerminalRoutesOptions {
  authStore: AuthStore;
}

/**
 * ADR-0095 ("Interactive C2 console (PTY)") is still Proposed, not
 * Accepted, and it is the decision that puts an interactive Shell/PTY
 * surface in scope at all (superseding the clause of ADR-0036 that kept it
 * out). The implementation plan's own rule (§3): don't build past a
 * Proposed ADR. Stub both ops rather than build ahead of a decision that
 * is still the repository owner's to make.
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerTerminalRoutes(app: FastifyInstance, options: TerminalRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);

  app.post("/api/terminal/run", { preHandler: requireSession }, notImplementedForThisDeployment);
  app.post("/api/terminal/run/stream", { preHandler: requireSession }, notImplementedForThisDeployment);
}
