import type { RuntimeTransport } from "../adapters/runtime/client.js";
import type { KnowledgeItemStore } from "../db/knowledge-item-store.js";
import type { ConversationStore } from "../db/conversation-store.js";
import type { RetrievalLogStore } from "../db/retrieval-log-store.js";

export interface LibraryQuery { search?: string; source?: string; category?: string; limit: number; offset: number }
export class KnowledgeLibrary {
  public constructor(private readonly runtime: RuntimeTransport, private readonly manual: KnowledgeItemStore) {}
  public async page(query: LibraryQuery): Promise<Record<string, unknown>> {
    const local = !query.source || query.source === "manual" ? await this.manual.page(query) : { items: [], total: 0 };
    let remote: { items: Record<string, unknown>[]; total: number; status?: unknown } = { items: [], total: 0 };
    let error: string | undefined;
    if (query.source !== "manual") {
      try {
        remote = await this.runtime.knowledgeRequest("library", {
          search: query.search ?? "", source: query.source ?? "", category: query.category ?? "",
          offset: Math.max(0, query.offset - local.total), limit: Math.max(1, query.limit - local.items.length),
        }) as typeof remote;
      } catch { error = "Reference runtime unavailable. Manual notes remain accessible; check the runtime connection and refresh."; }
    }
    return {
      enabled: true, document_page: true, total: local.total + remote.total,
      items: [...local.items.map(item => ({ ...item, source: "manual", type: "Markdown", index_status: "library", read_only: false })), ...remote.items].slice(0, query.limit),
      reference_status: remote.status, reference_error: error,
    };
  }
}

export async function knowledgeHistory(runtime: RuntimeTransport, conversations: ConversationStore, legacy: RetrievalLogStore, query: { conversationId?: string; search?: string; offset: number; limit: number }): Promise<Record<string, unknown>> {
  const selected = query.conversationId ? await conversations.findById(query.conversationId) : null;
  if (query.conversationId && !selected) return { logs: [], total: 0, conversations: [] };
  const known = (await conversations.list({ limit: 500, offset: 0 })).conversations;
  let remote: { logs: { id: string; thread_id: string; run_id: string; query: string; method: string; hits: number; items: string[]; status: string; created_at: string }[]; total: number } = { logs: [], total: 0 };
  let error: string | undefined;
  try { remote = await runtime.knowledgeRequest("history", { thread_id: selected?.runtimeThreadId ?? "", search: query.search ?? "", offset: query.offset, limit: query.limit }) as typeof remote; }
  catch { error = "Runtime retrieval history unavailable. Showing retained library history only."; }
  const old = query.offset === 0 ? await legacy.list({ conversationId: query.conversationId, limit: query.limit }) : [];
  return {
    logs: [...remote.logs.map(row => {
      const conversation = known.find(c => c.runtimeThreadId === row.thread_id);
      return { id: `runtime::${row.id}`, query: row.query, method: row.method, status: row.status, hits: row.hits, retrievedItems: row.items.map(id => `ref::${id}`), conversationId: conversation?.id, conversationTitle: conversation?.title, threadId: row.thread_id, runId: row.run_id, createdAt: row.created_at, source: "Reference graph", origin: row.thread_id ? "agent" : "operator" };
    }), ...old.map(row => ({ ...row, source: "Library history", createdAt: row.createdAt.toISOString() }))],
    total: remote.total + old.length, history_error: error,
    conversations: known.map(c => ({ id: c.id, title: c.title })),
  };
}
