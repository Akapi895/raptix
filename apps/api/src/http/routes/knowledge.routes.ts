import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { KnowledgeItemRecord, KnowledgeItemStore } from "../../db/knowledge-item-store.js";
import type { RetrievalLogStore } from "../../db/retrieval-log-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface KnowledgeRoutesOptions {
  authStore: AuthStore;
  knowledgeItemStore: KnowledgeItemStore;
  retrievalLogStore: RetrievalLogStore;
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

/**
 * index/index-status/scan would need a real embedding call (LiteLLM
 * /embeddings, the same pattern Skillogy's hybrid retrieval already uses --
 * see packages/raptix/raptix/skills/engine/server/app.py) AND a
 * retrieval/search endpoint to consume those embeddings during chat.
 * Neither a consumer nor a wiring point exists anywhere apps/api touches
 * yet; storing vectors nobody reads would be inert scaffolding dressed up
 * as a feature. apps/ui-app degrades this gracefully (indexStatus() treats
 * any non-2xx as "no status", scan()/startIndex() only error when clicked),
 * so items/categories/stats/retrieval-logs below stand on their own as a
 * real, browsable knowledge base.
 */
async function indexingNotImplemented(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerKnowledgeRoutes(app: FastifyInstance, options: KnowledgeRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { knowledgeItemStore, retrievalLogStore } = options;

  app.get("/api/knowledge/categories", { preHandler: requireSession }, async () => {
    const categories = await knowledgeItemStore.listCategories();
    return { enabled: true, categories };
  });

  app.get("/api/knowledge/items", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as { search?: string; category?: string; limit?: string; offset?: string };
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
    const query = request.query as { conversationId?: string; messageId?: string; limit?: string };
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
    const deleted = await retrievalLogStore.delete(id);
    return { success: deleted };
  });

  app.post("/api/knowledge/scan", { preHandler: requireSession }, indexingNotImplemented);
  app.post("/api/knowledge/index", { preHandler: requireSession }, indexingNotImplemented);
  app.get("/api/knowledge/index-status", { preHandler: requireSession }, indexingNotImplemented);
}
