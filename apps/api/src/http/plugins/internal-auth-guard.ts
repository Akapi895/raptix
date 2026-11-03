import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

/**
 * Fastify preHandler for the internal vault routes the Python runtime calls
 * (never apps/ui-app). Mirrors packages/raptix/raptix/interfaces/api/auth.py's
 * constant-time comparison, in the reverse direction: here apps/api is the
 * verifier and the runtime is the caller. A missing expectedToken (vault not
 * configured) refuses every call rather than silently accepting any token.
 */
export function createRequireInternalToken(expectedToken: string | undefined) {
  return async function requireInternalToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = bearerToken(request);
    const expected = expectedToken ? Buffer.from(expectedToken) : undefined;
    const actual = token ? Buffer.from(token) : undefined;
    if (!expected || !actual || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await reply.code(401).send({ error: "Invalid internal token" });
    }
  };
}
