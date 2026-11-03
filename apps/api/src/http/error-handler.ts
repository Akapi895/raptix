import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

/** Every error response is `{error: string}`, matching apps/ui-app's ErrorString contract (src/platform/http.ts). */
export function handleError(error: FastifyError, _request: FastifyRequest, reply: FastifyReply): void {
  const status = error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 600
    ? error.statusCode
    : 500;
  reply.code(status).send({ error: error.message || "Internal server error" });
}
