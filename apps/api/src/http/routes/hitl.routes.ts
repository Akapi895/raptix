import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface HitlRoutesOptions {
  authStore: AuthStore;
}

/**
 * Raptix's real HITL approval gate (packages/raptix/raptix/middleware/hitl.py,
 * HITLApprovalMiddleware) does NOT use a LangGraph thread interrupt. It
 * pauses synchronously inside the tool call and exchanges
 * `ApprovalRequest`/`ApprovalDecision` records as JSONL lines in the
 * *project's own sandbox* (`approvals/requests.jsonl` /
 * `approvals/decisions.jsonl`, via `ProjectFiles` -- ADR-0102: project files
 * only through the project sandbox). To serve `/api/hitl/pending` for real,
 * apps/api needs an HTTP client to the project sandbox's file API (Tier 4,
 * same integration layer as C2/webshell/environments) to tail
 * `requests.jsonl`; `/api/hitl/decision` and `/api/hitl/dismiss` need the
 * same client to append an `approval_decision` line to `decisions.jsonl`.
 * None of that exists yet -- stub honestly rather than fabricate a pending
 * queue or a decision that was never delivered to the running tool call.
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerHitlRoutes(app: FastifyInstance, options: HitlRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);

  for (const [method, path] of [
    ["GET", "/api/hitl/pending"],
    ["POST", "/api/hitl/decision"],
    ["POST", "/api/hitl/dismiss"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}
