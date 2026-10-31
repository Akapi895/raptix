import type { AuthStore, OperatorRecord, SessionRecord } from "../../src/db/auth-store.js";

/** In-memory AuthStore for route/guard tests -- no database needed. */
export class FakeAuthStore implements AuthStore {
  private readonly operators = new Map<string, OperatorRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private nextId = 1;

  public async findOperatorByUsername(username: string): Promise<OperatorRecord | null> {
    for (const operator of this.operators.values()) {
      if (operator.username === username) return operator;
    }
    return null;
  }

  public async findOperatorById(id: string): Promise<OperatorRecord | null> {
    return this.operators.get(id) ?? null;
  }

  public async findFirstOperator(): Promise<OperatorRecord | null> {
    const [first] = this.operators.values();
    return first ?? null;
  }

  public async createOperator(data: {
    username: string;
    displayName: string;
    passwordHash: string;
  }): Promise<OperatorRecord> {
    const operator: OperatorRecord = { id: `op-${this.nextId++}`, ...data };
    this.operators.set(operator.id, operator);
    return operator;
  }

  public async updateOperatorPassword(id: string, passwordHash: string): Promise<void> {
    const operator = this.operators.get(id);
    if (operator) operator.passwordHash = passwordHash;
  }

  public async createSession(data: { token: string; operatorId: string; expiresAt: Date }): Promise<void> {
    this.sessions.set(data.token, data);
  }

  public async findSession(token: string): Promise<(SessionRecord & { operator: OperatorRecord }) | null> {
    const session = this.sessions.get(token);
    if (!session) return null;
    const operator = this.operators.get(session.operatorId);
    if (!operator) return null;
    return { ...session, operator };
  }

  public async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}
