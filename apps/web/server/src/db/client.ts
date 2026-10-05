import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export interface CreateDbClientOptions {
  /**
   * PostgreSQL connection string. Required explicitly: this factory never
   * reads environment variables and importing this module performs no
   * connection or other side effect.
   */
  readonly connectionString: string;
}

/**
 * Create a Prisma client backed by the PostgreSQL driver adapter.
 * The client connects lazily on the first query; callers own the lifecycle
 * and must pass the connection string explicitly.
 */
export function createDbClient(options: CreateDbClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.connectionString });
  return new PrismaClient({ adapter });
}

/** Close the client's underlying connections. Safe to call once at shutdown. */
export async function disconnectDb(client: PrismaClient): Promise<void> {
  await client.$disconnect();
}
