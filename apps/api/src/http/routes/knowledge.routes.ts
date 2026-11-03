import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { KnowledgeItemRecord, KnowledgeItemStore } from "../../db/knowledge-item-store.js";
import type { RetrievalLogStore } from "../../db/retrieval-log-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";
import type { RuntimeTransport } from "../../adapters/runtime/client.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import type { KnowledgeConfigurationService } from "../../services/knowledge-configuration.js";
import { KnowledgeLibrary, knowledgeHistory } from "../../services/knowledge-library.js";
import { RuntimeRejectedError } from "../../adapters/runtime/errors.js";

class KnowledgeOperationError extends Error {
  public readonly statusCode: number;
  public constructor(error: unknown) {
    const rejected = error instanceof RuntimeRejectedError;
    super(rejected && [400, 404, 409, 422].includes(error.status) ? error.message : "Knowledge runtime unavailable. Check runtime authentication and Neo4j connectivity.");
    this.statusCode = rejected && [400, 404, 409, 422].includes(error.status) ? error.status : 503;
  }
}

export interface KnowledgeRoutesOptions {
  authStore: AuthStore;
  knowledgeItemStore: KnowledgeItemStore;
  retrievalLogStore: RetrievalLogStore;
  runtime: RuntimeTransport;
  conversationStore: ConversationStore;
  configuration: KnowledgeConfigurationService;
}

function itemWire(item: KnowledgeItemRecord) {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    content: item.content,
    filePath: item.filePath ?? undefined,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function registerKnowledgeRoutes(app: FastifyInstance, options: KnowledgeRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { knowledgeItemStore, retrievalLogStore } = options;
  const library = new KnowledgeLibrary(options.runtime, knowledgeItemStore);
  const invoke = (action: string, body: Record<string, unknown> = {}) => options.runtime.knowledgeRequest(action, body).catch(error => { throw new KnowledgeOperationError(error); });

  app.get("/api/knowledge/graph-configuration", { preHandler: requireSession }, async () => {
    const configuration = await options.configuration.snapshot();
    let status: unknown;
    try { status = await options.runtime.knowledgeRequest("status"); }
    catch { status = { graph_available: false, graph_error: "Knowledge runtime unavailable. Check the runtime connection.", initialized: false }; }
    return { ...configuration, status, applies_to: "New Web executions; running executions retain their snapshot. CLI defaults are unchanged." };
  });
  app.put<{ Body: { enabled: boolean; revision: number } }>("/api/knowledge/graph-configuration", {
    preHandler: requireSession, schema: { body: { type: "object", additionalProperties: false, required: ["enabled", "revision"], properties: { enabled: { type: "boolean" }, revision: { type: "integer", minimum: 0 } } } },
  }, request => options.configuration.update(request.body.enabled, request.body.revision));

  app.get("/api/knowledge/categories", { preHandler: requireSession }, async () => {
    const categories = await knowledgeItemStore.listCategories();
    return { enabled: true, categories };
  });

  app.get("/api/knowledge/items", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as { view?: string; source?: string; search?: string; category?: string; limit?: string; offset?: string };
    if (query.view === "documents") return library.page({ search: query.search?.slice(0, 200), source: query.source?.slice(0, 64), category: query.category?.slice(0, 128), limit: Math.min(100, Math.max(1, Number(query.limit) || 50)), offset: Math.min(100000, Math.max(0, Number(query.offset) || 0)) });
    if (query.search) {
      const { items, total } = await knowledgeItemStore.search(query.search);
      return { enabled: true, items: items.map(itemWire), total };
    }
    const limit = Math.max(1, Number(query.limit) || 10);
    const offset = Math.max(0, Number(query.offset) || 0);
    const { categories, total } = await knowledgeItemStore.listByCategoryPage({ category: query.category, limit, offset });
    return {
      enabled: true,
      categories: categories.map((group) => ({ category: group.category, itemCount: group.itemCount, items: group.items.map(itemWire) })),
      total,
    };
  });

  app.get("/api/knowledge/items/:id", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (id.startsWith("ref::")) return invoke("detail", { id });
    const item = await knowledgeItemStore.get(id);
    if (!item) {
      await reply.code(404).send({ error: "knowledge item not found" });
      return;
    }
    return itemWire(item);
  });

  app.post("/api/knowledge/items", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { category?: string; title?: string; content?: string } | undefined;
    if (!body?.category || !body.title || !body.content) {
      await reply.code(400).send({ error: "category, title and content are required" });
      return;
    }
    const item = await knowledgeItemStore.create({ category: body.category, title: body.title, content: body.content });
    return itemWire(item);
  });

  app.put("/api/knowledge/items/:id", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { category?: string; title?: string; content?: string } | undefined;
    if (!body?.category || !body.title || !body.content) {
      await reply.code(400).send({ error: "category, title and content are required" });
      return;
    }
    const item = await knowledgeItemStore.update(id, { category: body.category, title: body.title, content: body.content });
    if (!item) {
      await reply.code(404).send({ error: "knowledge item not found" });
      return;
    }
    return itemWire(item);
  });

  app.delete("/api/knowledge/items/:id", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const deleted = await knowledgeItemStore.delete(id);
    return { success: deleted };
  });

  app.get("/api/knowledge/stats", { preHandler: requireSession }, async () => {
    const stats = await knowledgeItemStore.stats();
    return { enabled: true, total_items: stats.totalItems, total_categories: stats.totalCategories };
  });

  app.get("/api/knowledge/retrieval-logs", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as { view?: string; search?: string; offset?: string; conversationId?: string; messageId?: string; limit?: string };
    if (query.view === "events") return knowledgeHistory(options.runtime, options.conversationStore, retrievalLogStore, { conversationId: query.conversationId, search: query.search?.slice(0, 200), offset: Math.min(100000, Math.max(0, Number(query.offset) || 0)), limit: Math.min(100, Math.max(1, Number(query.limit) || 50)) });
    const logs = await retrievalLogStore.list({
      conversationId: query.conversationId,
      messageId: query.messageId,
      limit: Math.max(1, Number(query.limit) || 100),
    });
    return {
      logs: logs.map((log) => ({
        id: log.id,
        query: log.query ?? undefined,
        conversationId: log.conversationId ?? undefined,
        messageId: log.messageId ?? undefined,
        riskType: log.riskType ?? undefined,
        retrievedItems: log.retrievedItems,
        hits: log.hits ?? undefined,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  });

  app.delete("/api/knowledge/retrieval-logs/:id", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    if (id.startsWith("runtime::")) return invoke("delete-history", { id: id.slice(9) });
    const deleted = await retrievalLogStore.delete(id);
    return { success: deleted };
  });

  app.post("/api/knowledge/scan", { preHandler: requireSession }, () => invoke("scan"));
  app.post<{ Body: { allow_partial?: boolean } }>("/api/knowledge/index", { preHandler: requireSession }, request => invoke("index", { allow_partial: request.body?.allow_partial === true }));
  app.get("/api/knowledge/index-status", { preHandler: requireSession }, () => invoke("status"));
  app.post<{ Body: { query: Record<string, unknown> } }>("/api/knowledge/retrieve", { preHandler: requireSession }, request => invoke("search", { query: request.body?.query }));
}
