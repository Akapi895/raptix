import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { isVaultRevealView, isVaultSecretView, isVaultView } from '@raptix/web-contracts';
import { registerErrorHandler } from '../src/http/error-handler.js';
import { registerVaultRoutes } from '../src/http/routes/vault.routes.js';
import { buildCapabilitiesResponse } from '../src/http/routes/capabilities.routes.js';
import { loadServerEnv } from '../src/config/env.js';
import { VaultService } from '../src/services/vault-service.js';

const IDENTITY = { id: 'local', mode: 'local-single-user' } as const;
const ENGAGEMENT = { id: 'eng-1', userId: 'local', name: 'w18-slug', displayName: null, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true, status: 'planning', threadId: 'th-1', workspacePath: null, runtimeContextLockedAt: new Date('2026-10-02T00:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') } as const;

interface SecretRow {
  id: string;
  engagementId: string;
  kind: string;
  label: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
interface AuditRow { id: string; engagementId: string; secretId: string; action: string; createdAt: Date }

function buildDb() {
  const secrets: SecretRow[] = [];
  const audits: AuditRow[] = [];
  let seq = 0;
  const now = () => new Date('2026-10-02T00:00:00Z');
  return {
    secrets,
    engagementClosure: { findFirst: async () => null },
    audits,
    engagement: { findFirst: async ({ where }: { where: { id: string; userId: string } }) => (where.id === ENGAGEMENT.id && where.userId === ENGAGEMENT.userId ? { ...ENGAGEMENT } : null) },
    vaultSecret: {
      findMany: async ({ where, take }: { where: { engagementId: string }; take: number }) => secrets.filter(row => row.engagementId === where.engagementId).slice(0, take),
      findFirst: async ({ where }: { where: { id: string; engagementId: string } }) => secrets.find(row => row.id === where.id && row.engagementId === where.engagementId) ?? null,
      create: async ({ data }: { data: Omit<SecretRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const row: SecretRow = { ...data, id: `sec-${++seq}`, createdAt: now(), updatedAt: now() };
        secrets.push(row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = secrets.findIndex(row => row.id === where.id);
        if (index === -1) throw new Error('record not found');
        return secrets.splice(index, 1)[0];
      },
    },
    vaultAudit: {
      create: async ({ data }: { data: Omit<AuditRow, 'id' | 'createdAt'> }) => {
        const row: AuditRow = { ...data, id: `audit-${audits.length + 1}`, createdAt: now() };
        audits.push(row);
        return row;
      },
      aggregate: async ({ where }: { where: { secretId: string; action: string } }) => {
        const matching = audits.filter(row => row.secretId === where.secretId && row.action === where.action);
        return { _count: { _all: matching.length }, _max: { createdAt: matching.length ? matching[matching.length - 1]!.createdAt : null } };
      },
    },
  } as never;
}

const KEY = randomBytes(32);

function buildApp(key: Buffer | null = KEY): FastifyInstance {
  const db = buildDb();
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerVaultRoutes(app, new VaultService(db, key), IDENTITY);
  return app;
}

describe('W18 vault storage', () => {
  it('stores secrets encrypted and returns redacted metadata only', async () => {
    const app = buildApp();
    const created = await app.inject({ method: 'POST', url: '/api/engagements/eng-1/vault/secrets', payload: { kind: 'api-key', label: 'Grafana admin', plaintext: 'hunter2-super-secret' } });
    expect(created.statusCode).toBe(201);
    const view = created.json();
    expect(isVaultSecretView(view)).toBe(true);
    expect(JSON.stringify(view)).not.toContain('hunter2');
    expect(view.revealCount).toBe(0);
    expect(view.lastRevealedAt).toBeNull();
    const list = await app.inject({ method: 'GET', url: '/api/engagements/eng-1/vault/secrets' });
    expect(list.statusCode).toBe(200);
    const vaultView = list.json();
    expect(isVaultView(vaultView)).toBe(true);
    expect(JSON.stringify(vaultView)).not.toContain('hunter2');
    expect(vaultView.secrets).toHaveLength(1);
  });

  it('reveals plaintext only through the explicit endpoint and audits every reveal', async () => {
    const app = buildApp();
    const created = (await app.inject({ method: 'POST', url: '/api/engagements/eng-1/vault/secrets', payload: { kind: 'password', label: 'Router', plaintext: 'reveal-me-once' } })).json();
    const revealed = await app.inject({ method: 'POST', url: `/api/engagements/eng-1/vault/secrets/${created.id}/reveal` });
    expect(revealed.statusCode).toBe(200);
    const revealView = revealed.json();
    expect(isVaultRevealView(revealView)).toBe(true);
    expect(revealView.plaintext).toBe('reveal-me-once');
    const metadata = (await app.inject({ method: 'GET', url: '/api/engagements/eng-1/vault/secrets' })).json();
    expect(metadata.secrets[0].revealCount).toBe(1);
    expect(metadata.secrets[0].lastRevealedAt).toBeTruthy();
    const second = (await app.inject({ method: 'POST', url: `/api/engagements/eng-1/vault/secrets/${created.id}/reveal` })).json();
    expect(second.plaintext).toBe('reveal-me-once');
    const after = (await app.inject({ method: 'GET', url: '/api/engagements/eng-1/vault/secrets' })).json();
    expect(after.secrets[0].revealCount).toBe(2);
  });

  it('refuses to store or reveal without a configured key and rejects invalid key configs', async () => {
    const app = buildApp(null);
    const store = await app.inject({ method: 'POST', url: '/api/engagements/eng-1/vault/secrets', payload: { kind: 'note', label: 'X', plaintext: 'value' } });
    expect(store.statusCode).toBe(503);
    expect(store.json().error.message).toContain('key not configured');
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-1/vault/secrets' })).statusCode).toBe(200);
    const badEnv = { VAULT_ENCRYPTION_KEY: Buffer.from('short').toString('base64') };
    expect(() => loadServerEnv(badEnv)).toThrow(/32 bytes/);
    const goodEnv = { VAULT_ENCRYPTION_KEY: KEY.toString('base64') };
    expect(loadServerEnv(goodEnv).vaultKey?.length).toBe(32);
  });

  it('never decrypts with a wrong key and revokes secrets with audited scope', async () => {
    const db = buildDb();
    const rightApp = Fastify({ logger: false });
    registerErrorHandler(rightApp);
    registerVaultRoutes(rightApp, new VaultService(db, KEY), IDENTITY);
    const created = (await rightApp.inject({ method: 'POST', url: '/api/engagements/eng-1/vault/secrets', payload: { kind: 'note', label: 'Rotate me', plaintext: 'rotate-value' } })).json();
    // A re-keyed deployment must fail closed without echoing any material.
    const wrongApp = Fastify({ logger: false });
    registerErrorHandler(wrongApp);
    registerVaultRoutes(wrongApp, new VaultService(db, randomBytes(32)), IDENTITY);
    const wrong = await wrongApp.inject({ method: 'POST', url: `/api/engagements/eng-1/vault/secrets/${created.id}/reveal` });
    expect(wrong.statusCode).toBe(503);
    expect(wrong.json().error.message).toContain('could not be decrypted');
    expect(JSON.stringify(wrong.json())).not.toContain('rotate-value');
    const revoked = await rightApp.inject({ method: 'DELETE', url: `/api/engagements/eng-1/vault/secrets/${created.id}` });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ ok: true });
    expect((await rightApp.inject({ method: 'DELETE', url: `/api/engagements/eng-1/vault/secrets/${created.id}` })).statusCode).toBe(404);
    expect((await rightApp.inject({ method: 'GET', url: '/api/engagements/eng-1/vault/secrets' })).json().secrets).toHaveLength(0);
  });

  it('answers 404 for foreign engagements and validates inputs', async () => {
    const app = buildApp();
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/vault/secrets' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-1/vault/secrets', payload: { kind: '', label: 'X', plaintext: 'v' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-1/vault/secrets', payload: { kind: 'note', label: 'L', plaintext: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-other/vault/secrets', payload: { kind: 'note', label: 'L', plaintext: 'v' } })).statusCode).toBe(404);
  });
});

describe('W18 capabilities', () => {
  it('reports the vault as configuration_missing until the AES key is provided', async () => {
    const unkeyed = await buildCapabilitiesResponse(true, undefined, undefined, true, true, true, true, true, true, true, true, true, true, false);
    expect(unkeyed.capabilities.vault).toEqual({ supported: true, available: false, reason: 'configuration_missing' });
    const keyed = await buildCapabilitiesResponse(true, undefined, undefined, true, true, true, true, true, true, true, true, true, true, true);
    expect(keyed.capabilities.vault).toEqual({ supported: true, available: true });
    const absent = await buildCapabilitiesResponse(true, undefined, undefined, true, true, true, true, true, true, true, true, true, false, false);
    expect(absent.capabilities.vault).toEqual({ supported: false, available: false, reason: 'service_missing' });
  });
});
