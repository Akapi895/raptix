import type {
  ConversationRecord,
  ConversationStore,
  CreateConversationInput,
  ListConversationsQuery,
  MessageRecord,
} from "../../src/db/conversation-store.js";

export class FakeConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, MessageRecord[]>();
  private nextId = 1;
  private nextMessageId = 1;

  public async list(query: ListConversationsQuery): Promise<{ conversations: ConversationRecord[]; total: number }> {
    let rows = [...this.conversations.values()];
    if (query.projectId) rows = rows.filter((c) => c.projectId === query.projectId);
    if (query.search) rows = rows.filter((c) => c.title.toLowerCase().includes(query.search!.toLowerCase()));
    rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const total = rows.length;
    return { conversations: rows.slice(query.offset, query.offset + query.limit), total };
  }

  public async create(input: CreateConversationInput): Promise<ConversationRecord> {
    const now = new Date();
    const conversation: ConversationRecord = {
      id: `conv-${this.nextId++}`,
      title: input.title,
      projectId: input.projectId ?? null,
      roleName: input.roleName ?? null,
      agentMode: "eino_single",
      pinned: false,
      runtimeThreadId: input.runtimeThreadId,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    return conversation;
  }

  public async findById(id: string): Promise<ConversationRecord | null> {
    return this.conversations.get(id) ?? null;
  }

  public async rename(id: string, title: string): Promise<ConversationRecord | null> {
    const existing = this.conversations.get(id);
    if (!existing) return null;
    const updated = { ...existing, title, updatedAt: new Date() };
    this.conversations.set(id, updated);
    return updated;
  }

  public async setPinned(id: string, pinned: boolean): Promise<ConversationRecord | null> {
    const existing = this.conversations.get(id);
    if (!existing) return null;
    const updated = { ...existing, pinned, updatedAt: new Date() };
    this.conversations.set(id, updated);
    return updated;
  }

  public async setProject(id: string, projectId: string | null): Promise<ConversationRecord | null> {
    const existing = this.conversations.get(id);
    if (!existing) return null;
    const updated = { ...existing, projectId, updatedAt: new Date() };
    this.conversations.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    this.messages.delete(id);
    return this.conversations.delete(id);
  }

  public async listMessages(conversationId: string): Promise<MessageRecord[]> {
    return this.messages.get(conversationId) ?? [];
  }

  public async appendMessage(conversationId: string, role: string, content: string): Promise<MessageRecord> {
    const now = new Date();
    const message: MessageRecord = { id: `msg-${this.nextMessageId++}`, conversationId, role, content, createdAt: now, updatedAt: now };
    const list = this.messages.get(conversationId) ?? [];
    list.push(message);
    this.messages.set(conversationId, list);
    return message;
  }
}
