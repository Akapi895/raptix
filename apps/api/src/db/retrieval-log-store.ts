import type { PrismaClient } from "../generated/prisma/client.js";

export interface RetrievalLogRecord {
  id: string;
  query: string | null;
  conversationId: string | null;
  messageId: string | null;
  riskType: string | null;
  retrievedItems: string[];
  hits: number | null;
  createdAt: Date;
}

export interface RetrievalLogStore {
  list(args: { conversationId?: string; messageId?: string; limit: number }): Promise<RetrievalLogRecord[]>;
  delete(id: string): Promise<boolean>;
}

export class PrismaRetrievalLogStore implements RetrievalLogStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(args: { conversationId?: string; messageId?: string; limit: number }): Promise<RetrievalLogRecord[]> {
    return this.db.retrievalLog.findMany({
      where: {
        ...(args.conversationId ? { conversationId: args.conversationId } : {}),
        ...(args.messageId ? { messageId: args.messageId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: args.limit,
    });
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.db.retrievalLog.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}
