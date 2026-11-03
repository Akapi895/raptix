import { describe, expect, it, vi } from 'vitest';
import { createVaultService, VaultError, type VaultTransport } from './service';

const wireSecret = (overrides: Record<string, unknown> = {}) => ({
  id: 's1', project_id: 'p1', scope: 'PROJECT', name: 'db-password', description: '', kind: 'credential',
  source_project_id: null, revoked_at: null, created_at: '2026-11-03T00:00:00.000Z', created_by: 'admin', ...overrides,
});

// vi.fn()'s inferred concrete return type doesn't structurally match VaultTransport's
// generic methods; the mocks below are the real shape at runtime, so the cast is safe.
function service(
  transport: Record<string, unknown>,
  timers?: { setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>; clearTimeout?: (h: ReturnType<typeof setTimeout>) => void },
) {
  return createVaultService({ transport: transport as unknown as VaultTransport, t: (key) => key, ...timers });
}

describe('vault service', () => {
  it('loads a project and its global secrets separately', async () => {
    const get = vi.fn(async (path: string) => (
      path === '/api/vault/global-secrets' ? { secrets: [wireSecret({ id: 'g1', scope: 'GLOBAL', project_id: null })] } : { secrets: [wireSecret()] }
    ));
    const vault = service({ get, post: vi.fn(), delete: vi.fn() });
    vault.state.projectId = 'p1';
    await vault.load();
    expect(vault.state.secrets).toHaveLength(1);
    expect(vault.state.secrets[0]?.name).toBe('db-password');
    expect(vault.state.globalSecrets[0]?.id).toBe('g1');
  });

  it('rejects an empty name before making any request', async () => {
    const post = vi.fn();
    const vault = service({ get: vi.fn(), post, delete: vi.fn() });
    vault.state.projectId = 'p1';
    await expect(vault.add('', 'value', '')).rejects.toThrow(VaultError);
    expect(post).not.toHaveBeenCalled();
  });

  it('stores a secret then reloads the list', async () => {
    const get = vi.fn(async () => ({ secrets: [wireSecret()] }));
    const post = vi.fn(async () => ({ id: 's1' }));
    const vault = service({ get, post, delete: vi.fn() });
    vault.state.projectId = 'p1';
    await vault.add('db-password', 'Sup3r!', 'found in config');
    expect(post).toHaveBeenCalledWith('/api/projects/p1/vault/secrets', { name: 'db-password', plaintext: 'Sup3r!', description: 'found in config' });
    expect(get).toHaveBeenCalled(); // reload after store
  });

  it('reveal holds the plaintext only in memory and never refetches an already-revealed secret', async () => {
    const post = vi.fn(async () => ({ plaintext: 'Sup3r!' }));
    const vault = service({ get: vi.fn(), post, delete: vi.fn() }, { setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimeout: () => {} });
    vault.state.projectId = 'p1';
    const target = { ...wireSecret() } as never;
    await vault.reveal(target);
    expect(vault.revealedValue('s1')).toBe('Sup3r!');
    await vault.reveal(target);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('auto-hides a revealed secret after the configured timeout', async () => {
    let scheduled: (() => void) | undefined;
    const post = vi.fn(async () => ({ plaintext: 'Sup3r!' }));
    const vault = service(
      { get: vi.fn(), post, delete: vi.fn() },
      { setTimeout: (fn) => { scheduled = fn; return 1 as unknown as ReturnType<typeof setTimeout>; }, clearTimeout: () => {} },
    );
    vault.state.projectId = 'p1';
    await vault.reveal({ id: 's1' } as never);
    expect(vault.revealedValue('s1')).toBe('Sup3r!');
    scheduled?.();
    expect(vault.revealedValue('s1')).toBeNull();
  });

  it('hide clears the revealed value immediately', async () => {
    const post = vi.fn(async () => ({ plaintext: 'Sup3r!' }));
    const vault = service({ get: vi.fn(), post, delete: vi.fn() }, { setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimeout: () => {} });
    vault.state.projectId = 'p1';
    await vault.reveal({ id: 's1' } as never);
    vault.hide('s1');
    expect(vault.revealedValue('s1')).toBeNull();
  });

  it('revoke clears any revealed value for that secret and reloads', async () => {
    const get = vi.fn(async () => ({ secrets: [] }));
    const post = vi.fn(async () => ({ plaintext: 'Sup3r!' }));
    const del = vi.fn(async () => ({ success: true }));
    const vault = service({ get, post, delete: del }, { setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimeout: () => {} });
    vault.state.projectId = 'p1';
    await vault.reveal({ id: 's1' } as never);
    await vault.revoke({ id: 's1' } as never);
    expect(del).toHaveBeenCalledWith('/api/projects/p1/vault/secrets/s1');
    expect(vault.revealedValue('s1')).toBeNull();
  });

  it('promote posts to the promote endpoint and reloads', async () => {
    const get = vi.fn(async () => ({ secrets: [] }));
    const post = vi.fn(async () => ({ id: 's1', scope: 'GLOBAL' }));
    const vault = service({ get, post, delete: vi.fn() });
    vault.state.projectId = 'p1';
    await vault.promote({ id: 's1' } as never);
    expect(post).toHaveBeenCalledWith('/api/projects/p1/vault/secrets/s1/promote');
  });

  it('dispose clears every revealed value', async () => {
    const post = vi.fn(async () => ({ plaintext: 'Sup3r!' }));
    const vault = service({ get: vi.fn(), post, delete: vi.fn() }, { setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimeout: () => {} });
    vault.state.projectId = 'p1';
    await vault.reveal({ id: 's1' } as never);
    vault.dispose();
    expect(vault.revealedValue('s1')).toBeNull();
  });
});
