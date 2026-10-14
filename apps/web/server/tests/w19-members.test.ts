import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { isMembersView } from '@raptix/web-contracts';
import { registerErrorHandler } from '../src/http/error-handler.js';
import { registerMembersRoutes } from '../src/http/routes/members.routes.js';
import { buildCapabilitiesResponse } from '../src/http/routes/capabilities.routes.js';
import { MembersService } from '../src/services/members-service.js';

const IDENTITY = { id: 'local', mode: 'local-single-user' } as const;
const ENGAGEMENT = { id: 'eng-1', userId: 'local', name: 'w19-slug', displayName: null, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true, status: 'planning', threadId: 'th-1', workspacePath: null, runtimeContextLockedAt: new Date('2026-10-02T00:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') } as const;

function buildDb() {
  return {
    engagement: { findFirst: async ({ where }: { where: { id: string; userId: string } }) => (where.id === ENGAGEMENT.id && where.userId === ENGAGEMENT.userId ? { ...ENGAGEMENT } : null) },
  } as never;
}

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerMembersRoutes(app, new MembersService(buildDb(), false), IDENTITY);
  return app;
}

describe('W19 members', () => {
  it('returns the truthful local single-user view with the stated invite reason', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/engagements/eng-1/members' });
    expect(response.statusCode).toBe(200);
    const view = response.json();
    expect(isMembersView(view)).toBe(true);
    expect(view.mode).toBe('local-single-user');
    expect(view.members).toEqual([{ id: 'local', label: 'Local Operator', role: 'operator', source: 'local' }]);
    expect(view.inviteSupported).toBe(false);
    expect(view.reason).toContain('authentication strategy');
  });

  it('answers 503 with the explicit reason for invite and removal attempts', async () => {
    const app = buildApp();
    const invite = await app.inject({ method: 'POST', url: '/api/engagements/eng-1/members', payload: { label: 'New Person', role: 'viewer' } });
    expect(invite.statusCode).toBe(503);
    expect(invite.json().error.code).toBe('unavailable');
    expect(invite.json().error.message).toContain('Inviting members is not supported');
    const remove = await app.inject({ method: 'DELETE', url: '/api/engagements/eng-1/members/someone-else' });
    expect(remove.statusCode).toBe(503);
    expect(remove.json().error.message).toContain('Removing members is not supported');
    expect((await app.inject({ method: 'DELETE', url: '/api/engagements/eng-1/members/%20%20' })).statusCode).toBe(400);
  });

  it('answers 404 for foreign engagements and keeps the members capability truthful', async () => {
    const app = buildApp();
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/members' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-other/members', payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/engagements/eng-other/members/m-1' })).statusCode).toBe(404);
    const available = await buildCapabilitiesResponse(true, undefined, undefined, true, true, true, true, true, true, true, true, true, true, true, true);
    expect(available.capabilities.members).toEqual({ supported: true, available: true });
    const absent = await buildCapabilitiesResponse(true, undefined, undefined, true, true, true, true, true, true, true, true, true, true, true, false);
    expect(absent.capabilities.members).toEqual({ supported: false, available: false, reason: 'service_missing' });
  });
});
