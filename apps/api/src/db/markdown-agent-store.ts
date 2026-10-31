import type { PrismaClient } from "../generated/prisma/client.js";

export interface MarkdownAgentRecord {
  id: string;
  name: string;
  description: string;
  isOrchestrator: boolean;
  tools: string[];
  instruction: string;
  bindRole: string;
  maxIterations: number;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarkdownAgentFields {
  name: string;
  description?: string;
  isOrchestrator?: boolean;
  tools?: string[];
  instruction?: string;
  bindRole?: string;
  maxIterations?: number;
  kind?: string;
}

export interface MarkdownAgentStore {
  list(): Promise<MarkdownAgentRecord[]>;
  get(id: string): Promise<MarkdownAgentRecord | null>;
  create(id: string, fields: MarkdownAgentFields): Promise<MarkdownAgentRecord>;
  update(id: string, fields: MarkdownAgentFields): Promise<MarkdownAgentRecord | null>;
  delete(id: string): Promise<boolean>;
}

export class PrismaMarkdownAgentStore implements MarkdownAgentStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(): Promise<MarkdownAgentRecord[]> {
    return this.db.markdownAgent.findMany({ orderBy: { name: "asc" } });
  }

  public async get(id: string): Promise<MarkdownAgentRecord | null> {
    return this.db.markdownAgent.findUnique({ where: { id } });
  }

  public async create(id: string, fields: MarkdownAgentFields): Promise<MarkdownAgentRecord> {
    return this.db.markdownAgent.create({
      data: {
        id,
        name: fields.name,
        description: fields.description ?? "",
        isOrchestrator: fields.isOrchestrator ?? false,
        tools: fields.tools ?? [],
        instruction: fields.instruction ?? "",
        bindRole: fields.bindRole ?? "",
        maxIterations: fields.maxIterations ?? 0,
        kind: fields.kind ?? "",
      },
    });
  }

  public async update(id: string, fields: MarkdownAgentFields): Promise<MarkdownAgentRecord | null> {
    const existing = await this.db.markdownAgent.findUnique({ where: { id } });
    if (!existing) return null;
    return this.db.markdownAgent.update({
      where: { id },
      data: {
        name: fields.name,
        description: fields.description ?? "",
        isOrchestrator: fields.isOrchestrator ?? false,
        tools: fields.tools ?? [],
        instruction: fields.instruction ?? "",
        bindRole: fields.bindRole ?? "",
        maxIterations: fields.maxIterations ?? 0,
        kind: fields.kind ?? "",
      },
    });
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.db.markdownAgent.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}
