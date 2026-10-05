import type { PrismaClient } from '../generated/prisma/client.js';
import type { MemberView, MembersView } from '@raptix/web-contracts';
import { ProjectApiError } from './projects-service.js';

/**
 * W19 members: the real single-user topology, stated honestly. The auth
 * bridge always resolves the local operator and `isAuthEnabled()` is false,
 * so there is no membership/RBAC schema to enforce: hosted multi-user
 * authentication (sessions, CSRF, origin policy, per-API authorization) is
 * a dependency that must land before any Invite/RBAC API exists. The view
 * shows the single local operator; invite and removal requests answer 503
 * with the explicit reason — no fake Owner/Viewer hierarchy, no imported
 * demo people.
 */
const UNSUPPORTED_REASON = 'Memberships require an authentication strategy (hosted multi-user auth with sessions, CSRF and origin policy, enforced on every scoped API) that this build does not have. The deployment stays a localhost-only single-user topology.';

export class MembersUnsupportedError extends ProjectApiError {
  public constructor(prefix: string) {
    super(503, `${prefix} ${UNSUPPORTED_REASON}`);
  }
}

export class MembersService {
  public constructor(private readonly db: PrismaClient) {}

  public async list(userId: string, engagementId: string): Promise<MembersView> {
    const engagement = await this.findEngagement(userId, engagementId);
    const members: MemberView[] = [{ id: 'local', label: 'Local Operator', role: 'operator', source: 'local' }];
    return { engagementId: engagement.id, mode: 'local-single-user', members, inviteSupported: false, reason: UNSUPPORTED_REASON, source: 'db' };
  }

  public async invite(userId: string, engagementId: string): Promise<never> {
    await this.findEngagement(userId, engagementId);
    throw new MembersUnsupportedError('Inviting members is not supported.');
  }

  public async removeMember(userId: string, engagementId: string, memberId: string): Promise<never> {
    if (memberId.trim().length === 0) throw new ProjectApiError(400, 'memberId is required');
    await this.findEngagement(userId, engagementId);
    throw new MembersUnsupportedError('Removing members is not supported.');
  }

  private async findEngagement(userId: string, engagementId: string) {
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!engagement) throw new ProjectApiError(404, 'Project not found');
    return engagement;
  }
}
