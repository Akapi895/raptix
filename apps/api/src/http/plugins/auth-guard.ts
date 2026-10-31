import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";

export interface AuthenticatedOperator {
  id: string;
  username: string;
  displayName: string;
}

declare module "fastify" {
  interface FastifyRequest {
    operator?: AuthenticatedOperator;
  }
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

/**
 * Fastify preHandler for every route under `security: [{ bearerAuth: [] }]`
 * in apps/ui-app/docs/openapi.yaml. Looks up the session by token (never by
 * decoding a JWT -- there is none), expires it server-side, and attaches
 * the operator to the request. Replies 401 `{error:"Invalid session"}`
 * itself on any failure, matching the contract's documented mock error.
 */
export function createRequireSession(store: AuthStore) {
  return async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = bearerToken(request);
    if (!token) {
      await reply.code(401).send({ error: "Invalid session" });
      return;
    }
    const session = await store.findSession(token);
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) await store.deleteSession(token);
      await reply.code(401).send({ error: "Invalid session" });
      return;
    }
    request.operator = {
      id: session.operator.id,
      username: session.operator.username,
      displayName: session.operator.displayName,
    };
  };
}
