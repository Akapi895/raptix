import { randomBytes, scryptSync } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { MemberView, MembersView } from '@raptix/web-contracts';
import { ProjectApiError } from './projects-service.js';
import { assertEngagementOpen } from './closure-service.js';
import { isMemberRole, requireEngagementAccess, type ActorContext, type MemberRole } from '../auth/membership-policy.js';

/**
 * W19 members, extended by integration ticket 07. Local single-user
 * deployments keep the honest unsupported view. Multi-user deployments
 * (RAPTIX_WEB_AUTH_MODE=multi) resolve access from persisted WebMembership
 * rows: listing needs viewer, invite/remove/role changes are owner-only and
 * every mutation is audited. Identities are persistent WebUser rows â€” the
 * actor comes from the session, never from the request body.
 */

const UNSUPPORTED_REASON = 'Memberships require an authentication strategy (hosted multi-user auth with sessions, CSRF and origin policy, enforced on every scoped API) that this build does not have. The deployment stays a localhost-only single-user topology.';

const INVITE_ROLES: readonly MemberRole[] = ['operator', 'reviewer', 'viewer'];

export class MembersUnsupportedError extends ProjectApiError {
  public constructor(prefix: string) {
    super(503, `${prefix} ${UNSUPPORTED_REASON}`);
  }
}

interface MemberRow { userId: string; username: string; displayName: string; role: MemberRole; source: 'membership' | 'owner' }

export class MembersService {
  public constructor(private readonly db: PrismaClient, private readonly multiUser: boolean) {}

  private ctx(userId: string): ActorContext {
    return { db: this.db, actorId: userId, multiUser: this.multiUser };
  }

  public async list(userId: string, engagementId: string): Promise<MembersView> {
    if (!this.multiUser) { await this.localAccess(userId, engagementId); return this.localView(engagementId); }
    await requireEngagementAccess(this.ctx(userId), engagementId, 'viewer');
    const rows = await this.memberRows(engagementId);
    const members: MemberView[] = rows.map((row) => ({
      id: row.userId,
      label: row.displayName || row.username,
      role: row.role,
      source: row.source === 'owner' ? 'local' : 'membership',
    }));
    return { engagementId, mode: 'multi-user', members, inviteSupported: true, reason: null, source: 'db' };
  }

  public async invite(userId: string, engagementId: string, input: unknown): Promise<{ ok: true; memberId: string }> {
    if (!this.multiUser) throw await this.unsupported(engagementId, userId, 'Inviting members is not supported.');
    const access = await requireEngagementAccess(this.ctx(userId), engagementId, 'owner');
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { username?: unknown; displayName?: unknown; password?: unknown; role?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : username;
    const password = typeof body.password === 'string' ? body.password : '';
    const role = typeof body.role === 'string' ? body.role : '';
    if (username.length < 1 || username.length > 200) throw new ProjectApiError(400, 'username (1-200 chars) is required.');
    if (password.length < 8 || password.length > 200) throw new ProjectApiError(400, 'password must be 8-200 characters.');
    if (!isMemberRole(role) || !INVITE_ROLES.includes(role)) {
      throw new ProjectApiError(400, `role must be one of: ${INVITE_ROLES.join(', ')}.`);
    }
    let user = await this.db.webUser.findUnique({ where: { username } });
    if (user === null) {
      user = await this.db.webUser.create({ data: { username, displayName: displayName || username, passwordHash: hashNewPassword(password) } });
    }
    const existing = await this.db.webMembership.findFirst({ where: { engagementId, userId: user.id } });
    if (existing !== null) throw new ProjectApiError(409, `${username} already has a membership on this engagement.`);
    const membership = await this.db.webMembership.create({ data: { engagementId, userId: user.id, role, invitedBy: access.role === 'owner' ? userId : userId } });
    await this.audit(engagementId, userId, 'member.invited', 'membership', membership.id, `invited ${username} as ${role}`);
    return { ok: true, memberId: user.id };
  }

  public async removeMember(userId: string, engagementId: string, memberId: string): Promise<{ ok: true }> {
    if (!this.multiUser) {
      if (memberId.trim().length === 0) throw new ProjectApiError(400, 'memberId is required');
      throw await this.unsupported(engagementId, userId, 'Removing members is not supported.');
    }
    await requireEngagementAccess(this.ctx(userId), engagementId, 'owner');
    if (memberId.trim().length === 0) throw new ProjectApiError(400, 'memberId is required');
    const membership = await this.db.webMembership.findFirst({ where: { engagementId, userId: memberId } });
    if (membership === null) throw new ProjectApiError(404, 'Membership not found');
    await this.db.webMembership.delete({ where: { id: membership.id } });
    await this.audit(engagementId, userId, 'member.removed', 'membership', membership.id, `removed member ${memberId}`);
    return { ok: true };
  }

  public async updateRole(userId: string, engagementId: string, memberId: string, input: unknown): Promise<{ ok: true; role: MemberRole }> {
    if (!this.multiUser) throw await this.unsupported(engagementId, userId, 'Changing roles is not supported.');
    await requireEngagementAccess(this.ctx(userId), engagementId, 'owner');
    const body = (input ?? {}) as { role?: unknown };
    const role = typeof body.role === 'string' ? body.role : '';
    if (!isMemberRole(role) || !INVITE_ROLES.includes(role)) {
      throw new ProjectApiError(400, `role must be one of: ${INVITE_ROLES.join(', ')}.`);
    }
    const membership = await this.db.webMembership.findFirst({ where: { engagementId, userId: memberId } });
    if (membership === null) throw new ProjectApiError(404, 'Membership not found');
    await this.db.webMembership.update({ where: { id: membership.id }, data: { role } });
    await this.audit(engagementId, userId, 'member.role_changed', 'membership', membership.id, `role set to ${role}`);
    return { ok: true, role };
  }

  private async memberRows(engagementId: string): Promise<MemberRow[]> {
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId }, select: { id: true, userId: true } });
    if (engagement === null) throw new ProjectApiError(404, 'Project not found');
    const owner = await this.db.webUser.findUnique({ where: { id: engagement.userId }, select: { username: true, displayName: true } });
    const memberships = await this.db.webMembership.findMany({ where: { engagementId } });
    const users = new Map<string, { username: string; displayName: string }>();
    for (const m of memberships) {
      const u = await this.db.webUser.findUnique({ where: { id: m.userId }, select: { username: true, displayName: true } });
      if (u !== null) users.set(m.userId, u);
    }
    const rows: MemberRow[] = [];
    if (owner !== null) rows.push({ userId: engagement.userId, username: owner.username, displayName: owner.displayName, role: 'owner', source: 'owner' });
    for (const m of memberships) {
      const u = users.get(m.userId);
      if (u === undefined || !isMemberRole(m.role)) continue;
      rows.push({ userId: m.userId, username: u.username, displayName: u.displayName, role: m.role, source: 'membership' });
    }
    return rows;
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }

  private async unsupported(engagementId: string, userId: string, prefix: string): Promise<never> {
    await this.localAccess(userId, engagementId);
    throw new MembersUnsupportedError(prefix);
  }

  /** Local mode still resolves ownership before answering, foreign ids 404. */
  private async localAccess(userId: string, engagementId: string): Promise<void> {
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!engagement) throw new ProjectApiError(404, 'Project not found');
  }

  private localView(engagementId: string): MembersView {
    const members: MemberView[] = [{ id: 'local', label: 'Local Operator', role: 'operator', source: 'local' }];
    return { engagementId, mode: 'local-single-user', members, inviteSupported: false, reason: UNSUPPORTED_REASON, source: 'db' };
  }
}

/** scrypt in the same PHC form as auth/multi-user (kept local to avoid importing secrets modules into repos of fakes). */
export function hashNewPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${dk.toString('base64')}`;
}
