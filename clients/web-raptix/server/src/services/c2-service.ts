import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';

/**
 * W17 C2 & sessions first real step: the scoped session/commands routes
 * exist and enforce engagement ownership, but no session provider is wired
 * in this build — no session/listener registry is reachable. Every call
 * therefore answers 503 with an explicit reason instead of fabricating
 * sessions, agent identities or command outputs. Agent threads, a CLI PTY
 * and C2 sessions stay distinct transports; no Docker/bash forwarding route
 * exists.
 */
export class ProviderUnavailableError extends ProjectApiError {
  public constructor(message: string) {
    super(503, message);
  }
}

const SESSIONS_MESSAGE = 'C2 session provider not configured; no session registry exists in this build';

export class C2Service {
  public constructor(private readonly db: PrismaClient) {}

  public async sessions(userId: string, engagementId: string): Promise<never> {
    await this.findEngagement(userId, engagementId);
    throw new ProviderUnavailableError(SESSIONS_MESSAGE);
  }

  public async dispatchCommand(userId: string, engagementId: string, sessionId: string): Promise<never> {
    if (sessionId.trim().length === 0) throw new ProjectApiError(400, 'sessionId is required');
    await this.findEngagement(userId, engagementId);
    throw new ProviderUnavailableError(SESSIONS_MESSAGE);
  }

  private async findEngagement(userId: string, engagementId: string) {
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!engagement) throw new ProjectApiError(404, 'Project not found');
    return engagement;
  }
}
