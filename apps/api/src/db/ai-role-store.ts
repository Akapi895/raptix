import type { PrismaClient } from "../generated/prisma/client.js";

export interface AiRoleRecord {
  name: string;
  description: string;
  icon: string;
  userPrompt: string;
  tools: string[];
  mcps: string[];
  enabled: boolean;
  workflowId: string;
  workflowPolicy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiRoleFields {
  description?: string;
  icon?: string;
  userPrompt?: string;
  tools?: string[];
  mcps?: string[];
  enabled?: boolean;
  workflowId?: string;
  workflowPolicy?: string;
}

export interface AiRoleStore {
  list(): Promise<AiRoleRecord[]>;
  get(name: string): Promise<AiRoleRecord | null>;
  create(name: string, fields: AiRoleFields): Promise<AiRoleRecord>;
  update(name: string, fields: AiRoleFields): Promise<AiRoleRecord | null>;
  delete(name: string): Promise<boolean>;
}

export class PrismaAiRoleStore implements AiRoleStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(): Promise<AiRoleRecord[]> {
    return this.db.aiRole.findMany({ orderBy: { name: "asc" } });
  }

  public async get(name: string): Promise<AiRoleRecord | null> {
    return this.db.aiRole.findUnique({ where: { name } });
  }

  public async create(name: string, fields: AiRoleFields): Promise<AiRoleRecord> {
    return this.db.aiRole.create({
      data: {
        name,
        description: fields.description ?? "",
        icon: fields.icon ?? "",
        userPrompt: fields.userPrompt ?? "",
        tools: fields.tools ?? [],
        mcps: fields.mcps ?? [],
        enabled: fields.enabled ?? true,
        workflowId: fields.workflowId ?? "",
        workflowPolicy: fields.workflowPolicy ?? "",
      },
    });
  }

  public async update(name: string, fields: AiRoleFields): Promise<AiRoleRecord | null> {
    const existing = await this.db.aiRole.findUnique({ where: { name } });
    if (!existing) return null;
    return this.db.aiRole.update({ where: { name }, data: fields });
  }

  public async delete(name: string): Promise<boolean> {
    try {
      await this.db.aiRole.delete({ where: { name } });
      return true;
    } catch {
      return false;
    }
  }
}
