import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface SkillsRoutesOptions {
  authStore: AuthStore;
}

/**
 * Skills management is stubbed in full, deliberately, not piecemeal.
 *
 * Raptix's skill corpus (packages/raptix-skills/raptix_skills/defs/) is a
 * Git-authored Markdown/YAML tree; editing it is documented as a
 * audit-skills -> build-skill-graph -> check-skill-graph -> commit pipeline
 * (CLAUDE.md), never a live-mutable store. A PUT/POST/DELETE here would
 * write a file (or nothing, since apps/api has no filesystem access to
 * that package in a real deployment -- see docker-compose.yml, apps/api
 * has no service entry there yet) without regenerating the Neo4j skill
 * graph, silently desyncing the two. That is the same guard-rail-adjacent
 * correctness concern Tier 4 stubbed C2/WebShell writes for.
 *
 * The read side has a real backend -- Skillogy (packages/raptix/raptix/
 * skills/engine/server, a separate Neo4j-backed REST service at
 * RAPTIX_SKILLOGY_URL) -- but its `find`/`load` operations require at
 * least one filter (subdomain/tag/mitre_id/tactic_id/query); the legacy
 * unconditional `/v1/skills:list` was deliberately removed (see that
 * module's own docstring). apps/ui-app's default list view
 * (GET /api/skills with no `search`) sends no filter at all, so it cannot
 * be served for real without Skillogy growing a new endpoint. Wiring only
 * the search-filtered case for real would make the page work when you
 * search and break on load -- a confusing half-measure with no real admin
 * value. Stub the whole module honestly instead.
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerSkillsRoutes(app: FastifyInstance, options: SkillsRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);

  for (const [method, path] of [
    ["GET", "/api/skills"],
    ["POST", "/api/skills"],
    ["GET", "/api/skills/:name"],
    ["PUT", "/api/skills/:name"],
    ["DELETE", "/api/skills/:name"],
    ["GET", "/api/skills/:name/bound-roles"],
    ["GET", "/api/skills/:name/file"],
    ["PUT", "/api/skills/:name/file"],
    ["GET", "/api/skills/:name/files"],
    ["DELETE", "/api/skills/:name/stats"],
    ["DELETE", "/api/skills/stats"],
    ["GET", "/api/skills/stats"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}
