import type { PrismaClient } from "../generated/prisma/client.js";

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationRecord {
  id: string;
  title: string;
  projectId: string | null;
  roleName: string | null;
  agentMode: string;
  pinned: boolean;
  runtimeThreadId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListConversationsQuery {
  projectId?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface CreateConversationInput {
  title: string;
  projectId?: string;
  roleName?: string;
  runtimeThreadId: string;
}

export interface ConversationStore {
  list(query: ListConversationsQuery): Promise<{ conversations: ConversationRecord[]; total: number }>;
  create(input: CreateConversationInput): Promise<ConversationRecord>;
  findById(id: string): Promise<ConversationRecord | null>;
  rename(id: string, title: string): Promise<ConversationRecord | null>;
  setPinned(id: string, pinned: boolean): Promise<ConversationRecord | null>;
  setProject(id: string, projectId: string | null): Promise<ConversationRecord | null>;
  delete(id: string): Promise<boolean>;
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  appendMessage(conversationId: string, role: string, content: string): Promise<MessageRecord>;
}

export class PrismaConversationStore implements ConversationStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(
    query: ListConversationsQuery,
  ): Promise<{ conversations: ConversationRecord[]; total: number }> {
    const where = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.search ? { title: { contains: query.search, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.conversation.findMany({ where, orderBy: { updatedAt: "desc" }, take: query.limit, skip: query.offset }),
      this.db.conversation.count({ where }),
    ]);
    return { conversations: rows, total };
  }

  public async create(input: CreateConversationInput): Promise<ConversationRecord> {
    return this.db.conversation.create({
      data: {
        title: input.title,
        projectId: input.projectId,
        roleName: input.roleName,
        runtimeThreadId: input.runtimeThreadId,
      },
    });
  }

  public async findById(id: string): Promise<ConversationRecord | null> {
    return this.db.conversation.findUnique({ where: { id } });
  }

  public async rename(id: string, title: string): Promise<ConversationRecord | null> {
    const exists = await this.db.conversation.findUnique({ where: { id } });
    if (!exists) return null;
    return this.db.conversation.update({ where: { id }, data: { title } });
  }

  public async setPinned(id: string, pinned: boolean): Promise<ConversationRecord | null> {
    const exists = await this.db.conversation.findUnique({ where: { id } });
    if (!exists) return null;
    return this.db.conversation.update({ where: { id }, data: { pinned } });
  }

  public async setProject(id: string, projectId: string | null): Promise<ConversationRecord | null> {
    const exists = await this.db.conversation.findUnique({ where: { id } });
    if (!exists) return null;
    return this.db.conversation.update({ where: { id }, data: { projectId } });
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.db.conversation.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  public async listMessages(conversationId: string): Promise<MessageRecord[]> {
    return this.db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  }

  public async appendMessage(conversationId: string, role: string, content: string): Promise<MessageRecord> {
    return this.db.message.create({ data: { conversationId, role, content } });
  }
}
