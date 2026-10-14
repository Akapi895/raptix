import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from '../services/projects-service.js';

/**
 * Ticket 07 authorization policy for web workflow surfaces: engagement
 * ownership (Engagement.userId) or a persisted WebMembership row grants
 * access; the role rank orders owner > operator > reviewer > viewer.
 * Independent-actor checks refuse same-actor decisions so a local identity
 * cannot approve its own work by renaming itself or picking a persona.
 */

export type MemberRole = 'owner' | 'operator' | 'reviewer' | 'viewer';

export const ROLE_RANK: Readonly<Record<MemberRole, number>> = { owner: 4, operator: 3, reviewer: 2, viewer: 1 };

export function isMemberRole(value: string): value is MemberRole {
  return value === 'owner' || value === 'operator' || value === 'reviewer' || value === 'viewer';
}

export interface ActorContext {
  readonly db: PrismaClient;
  /** Resolved trusted actor id (session user or the fixed local operator). */
  readonly actorId: string;
  /** False only for the fixed local single-user identity. */
  readonly multiUser: boolean;
}

export interface EngagementAccess {
  readonly engagementId: string;
  readonly role: MemberRole;
  /** True when the actor owns the engagement row (Engagement.userId). */
  readonly isOwner: boolean;
}

/**
 * Resolves the actor's role on an engagement: the owner keeps the owner role;
 * otherwise the persisted membership must grant at least `minRole`. Foreign
 * or unknown ids answer 404 without revealing the row's metadata.
 */
export async function requireEngagementAccess(ctx: ActorContext, engagementId: string, minRole: MemberRole): Promise<EngagementAccess> {
  const engagement = await ctx.db.engagement.findFirst({ where: { id: engagementId }, select: { id: true, userId: true } });
  if (engagement === null) throw new ProjectApiError(404, 'Project not found');
  if (engagement.userId === ctx.actorId) return { engagementId, role: 'owner', isOwner: true };
  const membership = await ctx.db.webMembership.findFirst({ where: { engagementId, userId: ctx.actorId } });
  if (membership === null || !isMemberRole(membership.role)) throw new ProjectApiError(404, 'Project not found');
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new ProjectApiError(403, `This action requires the ${minRole} role; the persisted membership grants ${membership.role}.`);
  }
  return { engagementId, role: membership.role, isOwner: false };
}

/** Four-eyes: a decision actor must differ from the requesting actor. */
export function requireIndependentActor(requestedBy: string, actorId: string, what: string): void {
  if (requestedBy === actorId) {
    throw new ProjectApiError(403, `${what} requires an independent actor: ${actorId} submitted this item and cannot decide it.`);
  }
}

/** Absolute deadline check used at every execute/bind/start/resume site. */
export function assertNotExpired(expiresAt: Date | null, now: number, what: string): void {
  if (expiresAt !== null && now >= expiresAt.getTime()) {
    throw new ProjectApiError(409, `${what} expired at ${expiresAt.toISOString()} and must be renewed before use.`);
  }
}
