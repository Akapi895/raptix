import type { PrismaClient } from "../generated/prisma/client.js";

export interface HiddenExecutionStore {
  hide(id: string): Promise<void>;
  hideMany(ids: string[]): Promise<void>;
  listHidden(): Promise<Set<string>>;
}

export class PrismaHiddenExecutionStore implements HiddenExecutionStore {
  public constructor(private readonly db: PrismaClient) {}

  public async hide(id: string): Promise<void> {
    await this.db.hiddenExecution.upsert({ where: { id }, create: { id }, update: {} });
  }

  public async hideMany(ids: string[]): Promise<void> {
    await this.db.$transaction(ids.map((id) => this.db.hiddenExecution.upsert({ where: { id }, create: { id }, update: {} })));
  }

  public async listHidden(): Promise<Set<string>> {
    const rows = await this.db.hiddenExecution.findMany({ select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }
}
