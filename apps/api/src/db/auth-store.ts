import type { PrismaClient } from "../generated/prisma/client.js";

export interface OperatorRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
}

export interface SessionRecord {
  token: string;
  operatorId: string;
  expiresAt: Date;
}

/**
 * Port for the single-operator/session records Tier 1 needs. Route handlers
 * and the auth guard depend on this interface, never on PrismaClient
 * directly, so they can be tested against a fake store with no database.
 */
export interface AuthStore {
  findOperatorByUsername(username: string): Promise<OperatorRecord | null>;
  findOperatorById(id: string): Promise<OperatorRecord | null>;
  findFirstOperator(): Promise<OperatorRecord | null>;
  createOperator(data: { username: string; displayName: string; passwordHash: string }): Promise<OperatorRecord>;
  updateOperatorPassword(id: string, passwordHash: string): Promise<void>;
  createSession(data: { token: string; operatorId: string; expiresAt: Date }): Promise<void>;
  findSession(token: string): Promise<(SessionRecord & { operator: OperatorRecord }) | null>;
  deleteSession(token: string): Promise<void>;
}

export class PrismaAuthStore implements AuthStore {
  public constructor(private readonly db: PrismaClient) {}

  public async findOperatorByUsername(username: string): Promise<OperatorRecord | null> {
    return this.db.operator.findUnique({ where: { username } });
  }

  public async findOperatorById(id: string): Promise<OperatorRecord | null> {
    return this.db.operator.findUnique({ where: { id } });
  }

  public async findFirstOperator(): Promise<OperatorRecord | null> {
    return this.db.operator.findFirst();
  }

  public async createOperator(data: {
    username: string;
    displayName: string;
    passwordHash: string;
  }): Promise<OperatorRecord> {
    return this.db.operator.create({ data });
  }

  public async updateOperatorPassword(id: string, passwordHash: string): Promise<void> {
    await this.db.operator.update({ where: { id }, data: { passwordHash } });
  }

  public async createSession(data: { token: string; operatorId: string; expiresAt: Date }): Promise<void> {
    await this.db.session.create({ data });
  }

  public async findSession(token: string): Promise<(SessionRecord & { operator: OperatorRecord }) | null> {
    return this.db.session.findUnique({ where: { token }, include: { operator: true } });
  }

  public async deleteSession(token: string): Promise<void> {
    await this.db.session.delete({ where: { token } }).catch(() => undefined);
  }
}
