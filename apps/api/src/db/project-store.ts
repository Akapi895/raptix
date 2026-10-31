import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  scopeJson: string | null;
  status: string;
  pinned: boolean;
  /** Sandbox identity (ADR-0086 A/ADR-0102) -- internal only, never on the wire (see projects.routes.ts's toWire). */
  workspaceSlug: string;
  createdAt: Date;
  updatedAt: Date;
  conversationCount: number;
  vulnerabilityCount: number;
  assetCount: number;
}

export interface ListProjectsQuery {
  status?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  scopeJson?: string;
  status?: string;
}

export interface UpdateProjectInput {
  name?: string | null;
  description?: string | null;
  scopeJson?: string | null;
  status?: string | null;
  pinned?: boolean | null;
}

export interface ProjectStore {
  list(query: ListProjectsQuery): Promise<{ projects: ProjectRecord[]; total: number }>;
  create(input: CreateProjectInput): Promise<ProjectRecord>;
  findById(id: string): Promise<ProjectRecord | null>;
  update(id: string, input: UpdateProjectInput): Promise<ProjectRecord | null>;
  delete(id: string): Promise<boolean>;
  stats(id: string): Promise<{ conversations: number; vulnerabilities: number; assets: number } | null>;
}

/** `sbx-<slug>` must be a valid DNS label (apps/launcher/internal/sandboxes.ValidSlug): lowercase hex is always valid. */
function generateWorkspaceSlug(): string {
  return `proj-${randomBytes(6).toString("hex")}`;
}

export class PrismaProjectStore implements ProjectStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(query: ListProjectsQuery): Promise<{ projects: ProjectRecord[]; total: number }> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.project.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: query.limit,
        skip: query.offset,
        include: { _count: { select: { conversations: true, vulnerabilities: true, assets: true } } },
      }),
      this.db.project.count({ where }),
    ]);
    return { projects: rows.map(toRecord), total };
  }

  public async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const row = await this.db.project.create({
      data: {
        name: input.name,
        description: input.description,
        scopeJson: input.scopeJson,
        status: input.status ?? "active",
        workspaceSlug: generateWorkspaceSlug(),
      },
      include: { _count: { select: { conversations: true, vulnerabilities: true, assets: true } } },
    });
    return toRecord(row);
  }

  public async findById(id: string): Promise<ProjectRecord | null> {
    const row = await this.db.project.findUnique({
      where: { id },
      include: { _count: { select: { conversations: true, vulnerabilities: true, assets: true } } },
    });
    return row ? toRecord(row) : null;
  }

  public async update(id: string, input: UpdateProjectInput): Promise<ProjectRecord | null> {
    const exists = await this.db.project.findUnique({ where: { id } });
    if (!exists) return null;
    const row = await this.db.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name ?? exists.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.scopeJson !== undefined ? { scopeJson: input.scopeJson } : {}),
        ...(input.status !== undefined ? { status: input.status ?? exists.status } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned ?? exists.pinned } : {}),
      },
      include: { _count: { select: { conversations: true, vulnerabilities: true, assets: true } } },
    });
    return toRecord(row);
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.db.project.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  public async stats(id: string): Promise<{ conversations: number; vulnerabilities: number; assets: number } | null> {
    const exists = await this.db.project.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return null;
    const [conversations, vulnerabilities, assets] = await Promise.all([
      this.db.conversation.count({ where: { projectId: id } }),
      this.db.vulnerability.count({ where: { projectId: id } }),
      this.db.asset.count({ where: { projectId: id } }),
    ]);
    return { conversations, vulnerabilities, assets };
  }
}

function toRecord(row: {
  id: string;
  name: string;
  description: string | null;
  scopeJson: string | null;
  status: string;
  pinned: boolean;
  workspaceSlug: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { conversations: number; vulnerabilities: number; assets: number };
}): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scopeJson: row.scopeJson,
    status: row.status,
    pinned: row.pinned,
    workspaceSlug: row.workspaceSlug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    conversationCount: row._count.conversations,
    vulnerabilityCount: row._count.vulnerabilities,
    assetCount: row._count.assets,
  };
}
