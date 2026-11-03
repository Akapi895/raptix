import type { FastifyInstance, FastifyReply } from "fastify";
import type { SkillsCorpus } from "../../adapters/skills/corpus.js";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface SkillsRoutesOptions {
  authStore: AuthStore;
  corpus: SkillsCorpus;
}

/**
 * Reads are real: Raptix's skill corpus (packages/raptix-skills/raptix_skills/
 * defs/, see adapters/skills/corpus.ts) is read straight off disk, never
 * through Skillogy (whose find/load ops require a filter apps/ui-app's
 * unfiltered list view can't supply -- the legacy unconditional
 * /v1/skills:list was deliberately removed, see that module's own
 * docstring).
 *
 * Writes stay stubbed, deliberately, not piecemeal: the corpus is a
 * Git-authored tree; editing it is documented as a audit-skills ->
 * build-skill-graph -> check-skill-graph -> commit pipeline (CLAUDE.md),
 * never a live-mutable store. A PUT/POST/DELETE here would write a file
 * without regenerating the Neo4j skill graph, silently desyncing the two
 * -- the same guard-rail-adjacent correctness concern Tier 4 stubbed
 * C2/WebShell writes for. `bound-roles` (which roles a skill is wired
 * into) and invocation stats are a separate, still-unbuilt telemetry
 * surface -- stats degrades to an honest all-zero count rather than a
 * fabricated one.
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

function toWireSummary(skill: { id: string; name: string; description: string; tags: string[]; path: string; subdomain?: string; updatedAt: Date; fileCount: number }) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    path: skill.path,
    updated_at: skill.updatedAt.toISOString(),
    mod_time: skill.updatedAt.toISOString(),
    file_count: skill.fileCount,
  };
}

export function registerSkillsRoutes(app: FastifyInstance, options: SkillsRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { corpus } = options;

  app.get<{ Querystring: { limit?: string; offset?: string; search?: string } }>(
    "/api/skills",
    { preHandler: requireSession },
    async (request) => {
      const all = await corpus.list();
      const search = (request.query.search ?? "").trim().toLowerCase();
      const filtered = search
        ? all.filter((skill) => skill.name.toLowerCase().includes(search) || skill.description.toLowerCase().includes(search) || skill.tags.some((tag) => tag.toLowerCase().includes(search)))
        : all;
      const offset = Math.max(0, Number(request.query.offset) || 0);
      const limit = Math.max(1, Number(request.query.limit) || 20);
      return { skills: filtered.slice(offset, offset + limit).map(toWireSummary), total: filtered.length };
    },
  );

  app.get<{ Params: { name: string }; Querystring: { depth?: string } }>(
    "/api/skills/:name",
    { preHandler: requireSession },
    async (request, reply) => {
      const skill = await corpus.get(request.params.name);
      if (!skill) {
        await reply.code(404).send({ error: "Skill not found" });
        return;
      }
      const summary = toWireSummary(skill);
      if (request.query.depth === "summary") return summary;
      return { ...summary, content: skill.content };
    },
  );

  app.get<{ Params: { name: string } }>("/api/skills/:name/files", { preHandler: requireSession }, async (request, reply) => {
    const files = await corpus.listFiles(request.params.name);
    if (files.length === 0 && (await corpus.get(request.params.name)) === null) {
      await reply.code(404).send({ error: "Skill not found" });
      return;
    }
    return { files: files.map((relPath) => ({ path: relPath })) };
  });

  app.get<{ Params: { name: string }; Querystring: { path?: string } }>(
    "/api/skills/:name/file",
    { preHandler: requireSession },
    async (request, reply) => {
      const relPath = request.query.path ?? "";
      const content = await corpus.readFile(request.params.name, relPath);
      if (content === null) {
        await reply.code(404).send({ error: "File not found" });
        return;
      }
      return { content };
    },
  );

  app.get("/api/skills/stats", { preHandler: requireSession }, async () => {
    const all = await corpus.list();
    return { total_skills: all.length, total_calls: 0, total_success: 0, total_failed: 0, stats: [] };
  });

  for (const [method, path] of [
    ["POST", "/api/skills"],
    ["PUT", "/api/skills/:name"],
    ["DELETE", "/api/skills/:name"],
    ["GET", "/api/skills/:name/bound-roles"],
    ["PUT", "/api/skills/:name/file"],
    ["DELETE", "/api/skills/:name/stats"],
    ["DELETE", "/api/skills/stats"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}
