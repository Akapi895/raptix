// A small least-recently-used cache of conversation summaries. It is only a fallback for when a request fails: a
// cached snapshot must never be shown before the server answers, because a running conversation keeps changing.

export interface ConversationLiteCache<T> {
  get(conversationId: string): T | null;
  put(conversationId: string, data: T): void;
  /** Drops one conversation, or every entry when no id is given. */
  invalidate(conversationId?: string): void;
  readonly size: number;
}

export function createConversationLiteCache<T>(maxEntries = 12): ConversationLiteCache<T> {
  const entries = new Map<string, T>();

  return {
    get(conversationId) {
      if (!conversationId) return null;
      const hit = entries.get(conversationId);
      if (hit === undefined) return null;
      // Re-insert so the entry becomes the most recently used one.
      entries.delete(conversationId);
      entries.set(conversationId, hit);
      return hit;
    },
    put(conversationId, data) {
      if (!conversationId || !data) return;
      entries.delete(conversationId);
      entries.set(conversationId, data);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
      }
    },
    invalidate(conversationId) {
      if (conversationId) entries.delete(conversationId);
      else entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
