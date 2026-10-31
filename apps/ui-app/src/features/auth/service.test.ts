import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../platform/http';
import { createAuthService, type AuthApi, type AuthStore } from './service';

const payload = {
  token: 'tok-1',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: 'u1', username: 'admin', display_name: 'Administrator' },
  roles: ['Administrator'],
  permissions: ['chat:read', 'settings:write'],
  scope: 'all',
};

function memoryStore(initial: unknown = null) {
  let value: string | null = initial === null ? null : JSON.stringify(initial);
  const store: AuthStore = {
    read: () => (value === null ? null : JSON.parse(value)),
    save: vi.fn((next: unknown) => { value = JSON.stringify(next); return true; }),
    clear: vi.fn(() => { value = null; }),
  };
  return { store, peek: () => value };
}

function fakeApi(overrides: Record<string, unknown> = {}): AuthApi {
  return {
    post: vi.fn(async (path: string) => (path === '/api/auth/login' ? payload : {})),
    get: vi.fn(async () => payload),
    delete: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as AuthApi;
}

const NOW = () => Date.parse('2026-01-01T00:00:00Z');

describe('auth service', () => {
  it('logs in, stores the session and exposes permissions', async () => {
    const { store, peek } = memoryStore();
    const service = createAuthService({ api: fakeApi(), store, now: NOW });
    expect(await service.login('admin', 'secret')).toEqual({ ok: true });
    expect(service.isAuthenticated()).toBe(true);
    expect(service.token()).toBe('tok-1');
    expect(service.hasPermission('chat:read')).toBe(true);
    expect(service.hasPermission('rbac:write')).toBe(false);
    expect(service.hasAnyPermission(['rbac:write', 'chat:read'])).toBe(true);
    expect(peek()).toContain('tok-1');
  });

  it('reports the server error message for a rejected login', async () => {
    const api = fakeApi({
      post: vi.fn(async () => { throw new HttpError(401, '/api/auth/login', { error: '\u5bc6\u7801\u9519\u8bef' }); }),
    });
    const service = createAuthService({ api, store: memoryStore().store, now: NOW });
    expect(await service.login('admin', 'bad')).toEqual({ ok: false, message: '\u5bc6\u7801\u9519\u8bef' });
    expect(service.isAuthenticated()).toBe(false);
  });

  it('returns no message when the server sends no explanation', async () => {
    const api = fakeApi({ post: vi.fn(async () => { throw new HttpError(500, '/api/auth/login', 'boom'); }) });
    const service = createAuthService({ api, store: memoryStore().store, now: NOW });
    expect(await service.login('admin', 'x')).toEqual({ ok: false, message: null });
  });

  it('restores a valid persisted session and ignores an expired one', () => {
    const valid = memoryStore({ token: 't', expiresAt: '2030-01-01T00:00:00Z', user: null, roles: [], permissions: ['a:b'], scope: 'own' });
    const restored = createAuthService({ api: fakeApi(), store: valid.store, now: NOW });
    expect(restored.restore()).toBe(true);
    expect(restored.hasPermission('a:b')).toBe(true);

    const expired = memoryStore({ token: 't', expiresAt: '2020-01-01T00:00:00Z', user: null, roles: [], permissions: [], scope: '' });
    const stale = createAuthService({ api: fakeApi(), store: expired.store, now: NOW });
    expect(stale.restore()).toBe(false);
  });

  it('clears the session when the server rejects validation', async () => {
    const { store } = memoryStore({ token: 't', expiresAt: '2030-01-01T00:00:00Z', user: null, roles: [], permissions: [], scope: '' });
    const api = fakeApi({ get: vi.fn(async () => { throw new HttpError(401, '/api/auth/validate', {}); }) });
    const service = createAuthService({ api, store, now: NOW });
    service.restore();
    expect(await service.validate()).toBe(false);
    expect(service.isAuthenticated()).toBe(false);
    expect(store.clear).toHaveBeenCalled();
  });

  it('resolves ensureAuthenticated only after a successful login and asks for the overlay', async () => {
    const service = createAuthService({ api: fakeApi(), store: memoryStore().store, now: NOW });
    const prompts: unknown[] = [];
    service.onLoginRequired(detail => prompts.push(detail));
    const gate = service.ensureAuthenticated();
    expect(prompts).toHaveLength(1);
    await service.login('admin', 'secret');
    await expect(gate).resolves.toBeUndefined();
  });

  it('notifies subscribers and clears everything on logout', async () => {
    const { store } = memoryStore();
    const service = createAuthService({ api: fakeApi(), store, now: NOW });
    const seen: boolean[] = [];
    service.subscribe(snapshot => seen.push(snapshot.authenticated));
    await service.login('admin', 'secret');
    await service.logout();
    expect(seen).toEqual([true, false]);
    expect(store.clear).toHaveBeenCalled();
  });

  it('calls the binding endpoints with the typed shapes', async () => {
    const api = fakeApi({
      post: vi.fn(async () => ({ code: 'ABCD', expires_in_seconds: 120 })),
      get: vi.fn(async () => ({ bindings: [{ id: 'b1', platform: 'wechat', external_user_hint: 'x', updated_at: null }] })),
    });
    const service = createAuthService({ api, store: memoryStore().store, now: NOW });
    expect(await service.requestBindingCode()).toEqual({ code: 'ABCD', expiresInSeconds: 120 });
    expect((await service.listBindings())[0]?.platform).toBe('wechat');
    await service.deleteBinding('a/b');
    expect(api.delete).toHaveBeenCalledWith('/api/auth/robot-bindings/a%2Fb');
  });
});
