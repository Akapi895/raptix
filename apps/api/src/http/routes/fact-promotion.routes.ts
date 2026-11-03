import type { FastifyInstance } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { FactStore } from "../../db/fact-store.js";
import type { ProjectStore } from "../../db/project-store.js";
import type { RuntimeTransport } from "../../adapters/runtime/client.js";
import { TRANSITIONS, type VerificationState } from "../../db/fact-verification.js";
import { candidatesWithHashes, FactPromotionService, type ProposeFactInput } from "../../services/fact-promotion.js";
import { createRequireSession } from "../plugins/auth-guard.js";

interface Options {
  authStore: AuthStore;
  projectStore: ProjectStore;
  factStore: FactStore;
  runtime: RuntimeTransport;
}

export function registerFactPromotionRoutes(app: FastifyInstance, options: Options): void {
  const { factStore, projectStore, runtime } = options;
  const requireSession = createRequireSession(options.authStore);
  const promotion = new FactPromotionService(runtime, factStore);
  const base = "/api/projects/:id";

  app.get<{ Params: { id: string }; Querystring: { query_type?: string; kind?: string; key?: string; q?: string; depth?: string; limit?: string } }>(`${base}/akg-candidates`, {
    preHandler: requireSession,
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      query_type: { type: "string", enum: ["search", "observation", "neighbors"] }, kind: { type: "string", maxLength: 64 }, key: { type: "string", maxLength: 2048 }, q: { type: "string", maxLength: 200 }, depth: { type: "integer", minimum: 1, maximum: 2 }, limit: { type: "integer", minimum: 1, maximum: 20 },
    } } },
  }, async (request, reply) => {
    const project = await projectStore.findById(request.params.id);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    const query = request.query;
    const response = await runtime.queryKnowledgeGraph(project.workspaceSlug, { graph: "runtime", query_type: query.query_type ?? "search", params: {
      kind: query.kind ?? "Vulnerability", key: query.key ?? "", q: query.q ?? "", depth: Number(query.depth ?? 1), limit: Number(query.limit ?? 20),
    } });
    const candidates = candidatesWithHashes(project.workspaceSlug, response);
    const findings = await factStore.linkedFindings(project.id, candidates.nodes.map(node => ({ kind: node.kind ?? "", key: node.key ?? "", observationId: String(node.props?.observation_id ?? "") })));
    return reply.send({ ...candidates, findings });
  });

  app.post<{ Params: { id: string }; Body: ProposeFactInput }>(`${base}/facts/propose`, {
    preHandler: requireSession,
    schema: { body: { type: "object", additionalProperties: false, required: ["fact_key", "observations"], properties: {
      fact_key: { type: "string", minLength: 1, maxLength: 256 }, summary: { type: "string", maxLength: 2000 }, body: { type: "string", maxLength: 32_000 }, expected_revision: { type: "integer", minimum: 1 },
      observations: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["kind", "key", "snapshot_hash"], properties: { kind: { type: "string", maxLength: 64 }, key: { type: "string", minLength: 1, maxLength: 2048 }, snapshot_hash: { type: "string", pattern: "^[a-f0-9]{64}$" } } } },
    } } },
  }, async (request, reply) => {
    const project = await projectStore.findById(request.params.id);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    try {
      return reply.send(await promotion.propose(project, request.body, request.operator!.id));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Fact already exists; refresh its revision before proposing" });
      throw error;
    }
  });

  app.get<{ Params: { id: string; factId: string }; Querystring: { offset?: number } }>(`${base}/facts/:factId/evidence`, { preHandler: requireSession, schema: { querystring: { type: "object", properties: { offset: { type: "integer", minimum: 0, maximum: 1_000_000 } }, additionalProperties: false } } }, async (request, reply) => {
    const fact = await factStore.findById(request.params.id, request.params.factId);
    if (!fact) return reply.code(404).send({ error: "Fact not found" });
    return reply.send(await factStore.evidence(request.params.id, fact.id, request.query.offset ?? 0));
  });

  app.post<{ Params: { id: string; factId: string }; Body: { verification_state: VerificationState; expected_revision: number; note?: string } }>(`${base}/facts/:factId/promote`, {
    preHandler: requireSession,
    schema: { body: { type: "object", additionalProperties: false, required: ["verification_state", "expected_revision"], properties: {
      verification_state: { type: "string", enum: Object.keys(TRANSITIONS) }, expected_revision: { type: "integer", minimum: 1 }, note: { type: "string", maxLength: 2000 },
    } } },
  }, async (request, reply) => {
    const { id, factId } = request.params;
    if (!await factStore.findById(id, factId)) return reply.code(404).send({ error: "Fact not found" });
    return reply.send(await factStore.transition(id, factId, request.body.expected_revision, request.body.verification_state, request.operator!.id, request.body.note ?? ""));
  });

  app.post<{ Params: { id: string }; Body: { query_type: string; params: Record<string, unknown> } }>(`${base}/knowledge-reference/query`, {
    preHandler: requireSession,
    schema: { body: { type: "object", additionalProperties: false, required: ["query_type", "params"], properties: { query_type: { type: "string", enum: ["technique_by_id", "mitigations_for_technique", "capec_for_cwe", "neighbors", "search_by_name"] }, params: { type: "object" } } } },
  }, async (request, reply) => {
    const project = await projectStore.findById(request.params.id);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    return reply.send(await runtime.queryKnowledgeGraph(project.workspaceSlug, { graph: "reference", ...request.body }));
  });
}
