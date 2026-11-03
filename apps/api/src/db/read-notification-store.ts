import type { PrismaClient } from "../generated/prisma/client.js";

export interface ReadNotificationStore {
  markRead(ids: string[]): Promise<void>;
  listRead(): Promise<Set<string>>;
}

export class PrismaReadNotificationStore implements ReadNotificationStore {
  public constructor(private readonly db: PrismaClient) {}

  public async markRead(ids: string[]): Promise<void> {
    await this.db.$transaction(ids.map((id) => this.db.readNotification.upsert({ where: { id }, create: { id }, update: {} })));
  }

  public async listRead(): Promise<Set<string>> {
    const rows = await this.db.readNotification.findMany({ select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }
}
