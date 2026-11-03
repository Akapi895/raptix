import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { WorkflowFields, WorkflowRecord, WorkflowStore } from "../../db/workflow-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface WorkflowRoutesOptions {
  authStore: AuthStore;
  workflowStore: WorkflowStore;
}

function toWire(workflow: WorkflowRecord) {
  let graph: unknown = { nodes: [], edges: [], config: {} };
  try {
    graph = JSON.parse(workflow.graphJson);
  } catch {
    // Keep the empty-graph fallback; a corrupt stored value is never surfaced as a parse crash.
  }
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    version: workflow.version,
    enabled: workflow.enabled,
    graph_json: workflow.graphJson,
    graph,
    validation_error: workflow.validationError,
    created_at: workflow.createdAt.toISOString(),
    updated_at: workflow.updatedAt.toISOString(),
  };
}

function fieldsFromBody(body: Record<string, unknown> | undefined): WorkflowFields | null {
  if (!body || typeof body.name !== "string" || !body.name) return null;
  return {
    name: body.name,
    description: typeof body.description === "string" ? body.description : "",
    enabled: body.enabled !== false,
    graphJson: JSON.stringify(body.graph ?? { nodes: [], edges: [], config: {} }),
  };
}

/**
 * Definition storage only -- list/create/update/delete of the graph
 * definition (graphJson) are real, Postgres-backed. Everything shaped
 * like *execution* is stubbed 501: validate/dry-run need the same
 * graph-interpretation engine actually running a workflow would need,
 * generate-draft needs an LLM call, package import/export need a
 * shareable-bundle format with its own async inspection/import jobs, and
 * runs/replay/resume need persisted execution instances with live
 * HITL-pause/resume semantics. Building any of those for real means
 * writing a new orchestration engine inside this BFF -- out of scope for
 * this tier per the repo owner's explicit accept/cut decision (plan §2,
 * "Workflows and packages"). Don't guess the shape of a subsystem this
 * size; stub honestly instead.
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerWorkflowRoutes(app: FastifyInstance, options: WorkflowRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { workflowStore } = options;

  app.get("/api/workflows", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as { includeDisabled?: string };
    const workflows = await workflowStore.list(query.includeDisabled !== "false");
    return { workflows: workflows.map(toWire) };
  });

  app.post("/api/workflows", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { id?: string } & Record<string, unknown> | undefined;
    const fields = fieldsFromBody(body);
    if (!fields) {
      await reply.code(400).send({ error: "name is required" });
      return;
    }
    const workflow = await workflowStore.create(body?.id && body.id.trim() ? body.id : undefined, fields);
    return { workflow: toWire(workflow) };
  });

  app.put("/api/workflows/:id", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const fields = fieldsFromBody(request.body as Record<string, unknown>);
    if (!fields) {
      await reply.code(400).send({ error: "name is required" });
      return;
    }
    const workflow = await workflowStore.update(id, fields);
    if (!workflow) {
      await reply.code(404).send({ error: "workflow not found" });
      return;
    }
    return { workflow: toWire(workflow) };
  });

  app.delete("/api/workflows/:id", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const deleted = await workflowStore.delete(id);
    return { success: deleted };
  });

  for (const [method, path] of [
    ["POST", "/api/workflows/validate"],
    ["POST", "/api/workflows/dry-run"],
    ["POST", "/api/workflows/generate-draft"],
    ["GET", "/api/workflows/:id/package"],
    ["POST", "/api/workflow-package-inspections"],
    ["GET", "/api/workflow-package-inspections/:id"],
    ["POST", "/api/workflow-package-imports"],
    ["GET", "/api/workflow-package-imports/:id"],
    ["GET", "/api/workflows/runs/pending"],
    ["GET", "/api/workflows/runs"],
    ["GET", "/api/workflows/runs/:id"],
    ["POST", "/api/workflows/runs/:id/replay"],
    ["POST", "/api/workflows/runs/:id/resume"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}
