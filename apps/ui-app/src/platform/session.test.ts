import { describe, expect, it, vi } from 'vitest';
import { createSessionStore } from './session';
import type { KeyValueStorage } from './storage';

function setup(raw: string | null) {
  const store: KeyValueStorage = { get: () => raw, set: vi.fn(() => true), remove: vi.fn(() => true) };
  return { store, session: createSessionStore(store, () => Date.parse('2026-10-28T12:00:00Z')) };
}

describe('persisted session boundary', () => {
  it('treats absent state as logged out without deleting', () => {
    const { session, store } = setup(null);
    expect(session.read()).toBeNull();
    expect(store.remove).not.toHaveBeenCalled();
  });

  it.each(['', '{bad', 'null', '[]', '{}', '{"token":"","expiresAt":"2026-10-29T00:00:00Z"}',
    '{"token":"t","expiresAt":"invalid"}', '{"token":"t","expiresAt":"2026-10-29T00:00:00Z","roles":{}}',
    '{"token":"t","expires_at":"2026-10-29T00:00:00Z"}',
    '{"token":"t","expiresAt":"2026-10-28T11:59:59Z"}', '{"token":"t","expiresAt":"2026-10-28T12:00:00Z"}',
  ])('removes corrupt or expired state: %s', (raw) => {
    const { session, store } = setup(raw);
    expect(session.read()).toBeNull();
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('raptix-auth');
  });

  it('reads old minimal sessions with defaults and accepts offset timestamps', () => {
    const { session } = setup('{"token":"t","expiresAt":"2026-10-28T14:00:00+01:00"}');
    expect(session.read()).toEqual({ token: 't', expiresAt: '2026-10-28T14:00:00+01:00', roles: [], permissions: [], scope: '' });
  });

  it('validates saves, reports persistence failures and clears explicitly', () => {
    const { session, store } = setup(null);
    const value = { token: 't', expiresAt: '2026-10-29T00:00:00Z', user: null, roles: ['admin'], permissions: ['projects:read'], scope: 'all' };
    expect(session.save(value)).toBe(true);
    expect(store.set).toHaveBeenCalledWith('raptix-auth', JSON.stringify(value));
    expect(() => session.save({ ...value, token: '' })).toThrow();
    vi.mocked(store.set).mockReturnValue(false);
    expect(session.save(value)).toBe(false);
    session.clear();
    expect(store.remove).toHaveBeenCalledWith('raptix-auth');
  });
});
