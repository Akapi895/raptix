import type { PrismaClient } from "../generated/prisma/client.js";

export interface MessageEventRecord {
  id: string;
  messageId: string;
  eventType: string;
  data: unknown;
  createdAt: Date;
}

export interface MessageEventInput {
  eventType: string;
  data: unknown;
}

/**
 * The Agents tab's execution tree (apps/ui-app's Message.processDetails):
 * one row per tool_call/tool_result captured while an assistant turn
 * streams -- see services/execution-events.ts for what gets captured and
 * agent-loop.routes.ts for where it's written (once, after the turn's
 * Message row exists; never partial, never guessed).
 */
export interface MessageEventStore {
  appendMany(messageId: string, events: MessageEventInput[]): Promise<void>;
  /** One lookup for every message on a conversation, keyed by messageId, in createdAt order. */
  listForMessages(messageIds: string[]): Promise<Map<string, MessageEventRecord[]>>;
}

function toRecord(row: { id: string; messageId: string; eventType: string; dataJson: string; createdAt: Date }): MessageEventRecord {
  let data: unknown = null;
  try {
    data = JSON.parse(row.dataJson);
  } catch {
    data = {};
  }
  return { id: row.id, messageId: row.messageId, eventType: row.eventType, data, createdAt: row.createdAt };
}

export class PrismaMessageEventStore implements MessageEventStore {
  public constructor(private readonly db: PrismaClient) {}

  public async appendMany(messageId: string, events: MessageEventInput[]): Promise<void> {
    if (events.length === 0) return;
    await this.db.messageEvent.createMany({
      data: events.map((event) => ({ messageId, eventType: event.eventType, dataJson: JSON.stringify(event.data) })),
    });
  }

  public async listForMessages(messageIds: string[]): Promise<Map<string, MessageEventRecord[]>> {
    if (messageIds.length === 0) return new Map();
    const rows = await this.db.messageEvent.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: { createdAt: "asc" },
    });
    const byMessage = new Map<string, MessageEventRecord[]>();
    for (const row of rows) {
      const record = toRecord(row);
      const list = byMessage.get(record.messageId) ?? [];
      list.push(record);
      byMessage.set(record.messageId, list);
    }
    return byMessage;
  }
}
