import type { RetrievalLogRecord, RetrievalLogStore } from "../../src/db/retrieval-log-store.js";

export class FakeRetrievalLogStore implements RetrievalLogStore {
  private logs = new Map<string, RetrievalLogRecord>();
  private nextId = 1;

  public seed(log: Omit<RetrievalLogRecord, "id" | "createdAt"> & Partial<Pick<RetrievalLogRecord, "id" | "createdAt">>): RetrievalLogRecord {
    const id = log.id ?? `log-${this.nextId++}`;
    const record: RetrievalLogRecord = { ...log, id, createdAt: log.createdAt ?? new Date() };
    this.logs.set(id, record);
    return record;
  }

  public async list(args: { conversationId?: string; messageId?: string; limit: number }): Promise<RetrievalLogRecord[]> {
    return [...this.logs.values()]
      .filter((log) => (!args.conversationId || log.conversationId === args.conversationId) && (!args.messageId || log.messageId === args.messageId))
      .slice(0, args.limit);
  }

  public async delete(id: string): Promise<boolean> {
    return this.logs.delete(id);
  }
}
