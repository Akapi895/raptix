import type { PrismaClient } from "../generated/prisma/client.js";

export interface WebShellConnectionRecord {
  id: string;
  projectId: string | null;
  url: string;
  password: string;
  type: string;
  method: string;
  cmdParam: string;
  remark: string;
  encoding: string;
  os: string;
  stateJson: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebShellConnectionFields {
  projectId?: string | null;
  url?: string;
  password?: string;
  type?: string;
  method?: string;
  cmdParam?: string;
  remark?: string;
  encoding?: string;
  os?: string;
}

export interface WebShellStore {
  list(): Promise<WebShellConnectionRecord[]>;
  create(fields: WebShellConnectionFields & { url: string }): Promise<WebShellConnectionRecord>;
  findById(id: string): Promise<WebShellConnectionRecord | null>;
  update(id: string, fields: WebShellConnectionFields): Promise<WebShellConnectionRecord | null>;
  delete(id: string): Promise<boolean>;
  setState(id: string, stateJson: string): Promise<WebShellConnectionRecord | null>;
  linkedConversationIds(id: string): Promise<string[]>;
}

export class PrismaWebShellStore implements WebShellStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(): Promise<WebShellConnectionRecord[]> {
    return this.db.webShellConnection.findMany({ orderBy: { createdAt: "desc" } });
  }

  public async create(fields: WebShellConnectionFields & { url: string }): Promise<WebShellConnectionRecord> {
    return this.db.webShellConnection.create({
      data: {
        url: fields.url,
        projectId: fields.projectId,
        password: fields.password ?? "",
        type: fields.type ?? "php",
        method: fields.method ?? "post",
        cmdParam: fields.cmdParam ?? "",
        remark: fields.remark ?? "",
        encoding: fields.encoding ?? "auto",
        os: fields.os ?? "auto",
      },
    });
  }

  public async findById(id: string): Promise<WebShellConnectionRecord | null> {
    return this.db.webShellConnection.findUnique({ where: { id } });
  }

  public async update(id: string, fields: WebShellConnectionFields): Promise<WebShellConnectionRecord | null> {
    const exists = await this.db.webShellConnection.findUnique({ where: { id } });
    if (!exists) return null;
    return this.db.webShellConnection.update({
      where: { id },
      data: Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    });
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.db.webShellConnection.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  public async setState(id: string, stateJson: string): Promise<WebShellConnectionRecord | null> {
    const exists = await this.db.webShellConnection.findUnique({ where: { id } });
    if (!exists) return null;
    return this.db.webShellConnection.update({ where: { id }, data: { stateJson } });
  }

  public async linkedConversationIds(id: string): Promise<string[]> {
    const rows = await this.db.conversation.findMany({ where: { webshellConnectionId: id }, select: { id: true }, orderBy: { updatedAt: "desc" } });
    return rows.map((row) => row.id);
  }
}
