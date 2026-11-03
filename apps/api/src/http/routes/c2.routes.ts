import type { FastifyInstance, FastifyReply } from "fastify";
import type { C2Transport } from "../../adapters/c2/client.js";
import { C2RejectedError, C2UnavailableError } from "../../adapters/c2/errors.js";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface C2RoutesOptions {
  authStore: AuthStore;
  c2: C2Transport;
}

async function replyC2Error(reply: FastifyReply, error: unknown): Promise<void> {
  if (error instanceof C2RejectedError) {
    await reply.code(error.status).send({ error: error.message });
    return;
  }
  if (error instanceof C2UnavailableError) {
    await reply.code(503).send({ error: error.message });
    return;
  }
  throw error;
}

/**
 * Mutating/dangerous C2 ops (start/stop a listener, create/delete a
 * profile, build a payload, and above all dispatching a task to a live
 * session) are stubbed 501 here, not wired to the bridge, even though the
 * bridge client (adapters/c2/client.ts) can carry them mechanically. The
 * retired apps/web/server's C2Service gated every one of these behind an
 * approved ScopeRevision + a per-command grant (C2GrantsService) before
 * ever calling the provider -- apps/api has no Scope/Governance subsystem
 * (Tier 6). Wiring a session.tasks dispatch (send a command to a live
 * implant) with no RoE/scope gate at all would be exactly the kind of
 * guard-rail weakening CONTRIBUTING_AGENT.md requires an ADR + threat
 * model for; refusing by default is the safe, intentional choice.
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerC2Routes(app: FastifyInstance, options: C2RoutesOptions): void {
  const { authStore, c2 } = options;
  const requireSession = createRequireSession(authStore);

  app.get("/api/c2/sessions", { preHandler: requireSession }, async (_request, reply) => {
    try {
      await reply.send(await c2.call("sessions.list"));
    } catch (error) {
      await replyC2Error(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/c2/sessions/:id", { preHandler: requireSession }, async (request, reply) => {
    try {
      await reply.send(await c2.call("sessions.get", { sessionId: request.params.id }));
    } catch (error) {
      await replyC2Error(reply, error);
    }
  });

  app.get("/api/c2/listeners", { preHandler: requireSession }, async (_request, reply) => {
    try {
      await reply.send(await c2.call("listeners.list"));
    } catch (error) {
      await replyC2Error(reply, error);
    }
  });

  app.get("/api/c2/profiles", { preHandler: requireSession }, async (_request, reply) => {
    try {
      await reply.send(await c2.call("profiles.list"));
    } catch (error) {
      await replyC2Error(reply, error);
    }
  });

  // Mutating ops (see the module doc comment above) plus tasks/events/payloads/files: the
  // retired client only evidenced sessions.list/get, listeners.list, profiles.list as real
  // bridge ops -- there is no evidence of what op name the bridge expects for tasks or
  // events, so those are stubbed too rather than guessed.
  for (const [method, path] of [
    ["DELETE", "/api/c2/events"],
    ["GET", "/api/c2/events"],
    ["GET", "/api/c2/events/:id"],
    ["GET", "/api/c2/events/stream"],
    ["POST", "/api/c2/files/upload"],
    ["GET", "/api/c2/listeners/:id"],
    ["POST", "/api/c2/listeners"],
    ["DELETE", "/api/c2/listeners/:id"],
    ["PUT", "/api/c2/listeners/:id"],
    ["POST", "/api/c2/listeners/:id/start"],
    ["POST", "/api/c2/listeners/:id/stop"],
    ["GET", "/api/c2/payloads/:id/download"],
    ["POST", "/api/c2/payloads/build"],
    ["POST", "/api/c2/payloads/oneliner"],
    ["POST", "/api/c2/profiles"],
    ["DELETE", "/api/c2/profiles/:id"],
    ["PUT", "/api/c2/profiles/:id"],
    ["DELETE", "/api/c2/sessions"],
    ["DELETE", "/api/c2/sessions/:id"],
    ["PUT", "/api/c2/sessions/:id/note"],
    ["PUT", "/api/c2/sessions/:id/sleep"],
    ["POST", "/api/c2/sessions/:id/tasks"],
    ["DELETE", "/api/c2/tasks"],
    ["GET", "/api/c2/tasks"],
    ["POST", "/api/c2/tasks"],
    ["GET", "/api/c2/tasks/:id"],
    ["POST", "/api/c2/tasks/:id/cancel"],
    ["GET", "/api/c2/tasks/:id/result-file"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}
