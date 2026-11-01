import type { MessageEventInput, MessageEventRecord, MessageEventStore } from "../../src/db/message-event-store.js";

export class FakeMessageEventStore implements MessageEventStore {
  private readonly byMessage = new Map<string, MessageEventRecord[]>();
  private nextId = 1;

  public async appendMany(messageId: string, events: MessageEventInput[]): Promise<void> {
    if (events.length === 0) return;
    const list = this.byMessage.get(messageId) ?? [];
    for (const event of events) {
      list.push({ id: `evt-${this.nextId++}`, messageId, eventType: event.eventType, data: event.data, createdAt: new Date() });
    }
    this.byMessage.set(messageId, list);
  }

  public async listForMessages(messageIds: string[]): Promise<Map<string, MessageEventRecord[]>> {
    const result = new Map<string, MessageEventRecord[]>();
    for (const id of messageIds) {
      const list = this.byMessage.get(id);
      if (list) result.set(id, list);
    }
    return result;
  }
}
