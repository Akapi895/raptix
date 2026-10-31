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
 * `approvals/decisions.jsonl`, via `ProjectFiles` -- ADR-0102). Tier 3 built
 * the sandbox-file HTTP client this needs (`adapters/sandbox/`, used for
 * real by files.routes.ts) -- but that alone is not enough here. The
 * client's `workspaceSlug` must be the *same sandbox the runtime actually
 * dispatched this conversation's tool calls to*, and agent-loop.routes.ts's
 * `createRun` does not pass any per-project sandbox routing
 * (`configurable.sandbox_url`/`sandbox_token`) to the runtime yet -- every
 * Tier 2 conversation currently runs against the runtime's default sandbox,
 * not an `apps/api`-Project-scoped one. Wiring that routing is a Tier 2/4
 * retrofit of its own (and needs a provisioning story for `sbx-<slug>`
 * containers per `apps/api` Project, which nothing creates today either).
 * Stub honestly rather than tail/append a sandbox that may not be the one
 * actually running the gated tool call.
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
