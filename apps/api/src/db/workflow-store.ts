import type { PrismaClient } from "../generated/prisma/client.js";

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  version: number;
  enabled: boolean;
  graphJson: string;
  validationError: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowFields {
  name: string;
  description?: string;
  enabled?: boolean;
  graphJson: string;
}

export interface WorkflowStore {
  list(includeDisabled: boolean): Promise<WorkflowRecord[]>;
  get(id: string): Promise<WorkflowRecord | null>;
  create(id: string | undefined, fields: WorkflowFields): Promise<WorkflowRecord>;
  update(id: string, fields: WorkflowFields): Promise<WorkflowRecord | null>;
  delete(id: string): Promise<boolean>;
}

export class PrismaWorkflowStore implements WorkflowStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(includeDisabled: boolean): Promise<WorkflowRecord[]> {
    return this.db.workflow.findMany({ where: includeDisabled ? {} : { enabled: true }, orderBy: { updatedAt: "desc" } });
  }

  public async get(id: string): Promise<WorkflowRecord | null> {
    return this.db.workflow.findUnique({ where: { id } });
  }

  public async create(id: string | undefined, fields: WorkflowFields): Promise<WorkflowRecord> {
    return this.db.workflow.create({
      data: {
        ...(id ? { id } : {}),
        name: fields.name,
        description: fields.description ?? "",
        enabled: fields.enabled ?? true,
        graphJson: fields.graphJson,
      },
    });
  }

  public async update(id: string, fields: WorkflowFields): Promise<WorkflowRecord | null> {
    const existing = await this.db.workflow.findUnique({ where: { id } });
    if (!existing) return null;
    return this.db.workflow.update({
      where: { id },
      data: {
        name: fields.name,
        description: fields.description ?? "",
        enabled: fields.enabled ?? true,
        graphJson: fields.graphJson,
        version: existing.version + 1,
      },
    });
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.db.workflow.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}
