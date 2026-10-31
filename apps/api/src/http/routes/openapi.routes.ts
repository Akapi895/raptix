import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import { parse } from "yaml";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface OpenApiRoutesOptions {
  authStore: AuthStore;
  specPath?: string;
}

const DEFAULT_SPEC_PATH = fileURLToPath(new URL("../../../../ui-app/docs/openapi.yaml", import.meta.url));

let cachedSpec: unknown;
let cachedFromPath: string | undefined;

/**
 * Serves apps/ui-app's own OpenAPI spec (its docs/openapi.yaml) parsed to
 * JSON, per this plan's own §2 note for this module. Read from the sibling
 * package's checked-in file, not apps/api's own generated spec -- apps/api
 * has no OpenAPI generator wired up, and this is what apps/ui-app's
 * api-docs page actually expects to render. A deployment where apps/api
 * doesn't have that sibling directory on disk (a container built from
 * apps/api alone, with no monorepo checkout) gets a clear 503, never a
 * fabricated empty spec.
 */
export function registerOpenApiRoutes(app: FastifyInstance, options: OpenApiRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const specPath = options.specPath ?? DEFAULT_SPEC_PATH;

  app.get("/api/openapi/spec", { preHandler: requireSession }, async (_request, reply: FastifyReply) => {
    try {
      if (cachedFromPath !== specPath) {
        const raw = await readFile(specPath, "utf8");
        cachedSpec = parse(raw);
        cachedFromPath = specPath;
      }
      return cachedSpec;
    } catch (error) {
      await reply.code(503).send({ error: `openapi spec unavailable: ${(error as Error).message}` });
      return;
    }
  });
}
