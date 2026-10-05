import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { EvilginxClient } from '../src/integrations/campaigns/evilginx-client.js';
import { loadServerEnv } from '../src/config/env.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function provider(mode: 'valid' | 'foreign' | 'credentials' | 'failed' | 'oversized' = 'valid') {
  const app = Fastify({ logger: false, forceCloseConnections: true });
  app.post('/v1/campaigns', async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${'a'.repeat(64)}`) return reply.code(401).send({ secret: 'private-token' });
    if (mode === 'failed') return reply.code(503).send({ password: 'private-token' });
    if (mode === 'oversized') return reply.send('x'.repeat(20000));
    const { engagementId, campaignId, version, operation } = request.body as { engagementId: string; campaignId: string; version: number; operation: string };
    const label = createHash('sha256').update(JSON.stringify([mode === 'foreign' ? 'foreign' : engagementId, campaignId, version])).digest('hex').slice(0, 20);
    return { provider: 'evilginx2', phishlet: `lab:${label}`, lureId: 0, providerId: `lab:${label}:0`,
      providerStatus: operation === 'deploy' ? 'enabled' : 'disabled', version, fingerprint: 'b'.repeat(64), url: `https://login.${label}.lab.test:8443/lab`,
      ...(mode === 'credentials' ? { captured_password: 'private-token', cookies: ['private-token'] } : {}) };
  });
  const apiUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  closers.push(() => app.close());
  return new EvilginxClient({ apiUrl, apiKey: 'a'.repeat(64) });
}

describe('IW-08 typed evilginx bridge client', () => {
  it('accepts native lure ID zero and its scoped lab metadata', async () => {
    const manifest = await (await provider()).operate('eng-1', 'camp-1', 2, 'prepare');
    expect(manifest).toMatchObject({ provider: 'evilginx2', lureId: 0, version: 2, providerStatus: 'disabled' });
  });

  it('rejects a manifest belonging to a different engagement', async () => {
    await expect((await provider('foreign')).operate('eng-1', 'camp-1', 2, 'inspect')).rejects.toThrow(/not confirmed/);
  });

  it('drops captures and cookies from the public manifest', async () => {
    const manifest = await (await provider('credentials')).operate('eng-1', 'camp-1', 2, 'inspect');
    expect(JSON.stringify(manifest)).not.toMatch(/private-token|captured_password|cookies/);
  });

  it.each(['failed', 'oversized'] as const)('bounds and sanitizes %s bridge responses', async mode => {
    await expect((await provider(mode)).operate('eng-1', 'camp-1', 2, 'deploy')).rejects.toThrow('Evilginx lab bridge operation was not confirmed');
  });

  it('validates paired bridge configuration without echoing a token', () => {
    expect(() => loadServerEnv({ EVILGINX_BRIDGE_TOKEN: 'private-token'.repeat(4) })).toThrow(/EVILGINX_BRIDGE_URL/);
    expect(() => loadServerEnv({ EVILGINX_BRIDGE_URL: 'http://production.invalid', EVILGINX_BRIDGE_TOKEN: 'a'.repeat(64) })).toThrow(/EVILGINX_BRIDGE_URL/);
    expect(loadServerEnv({ EVILGINX_BRIDGE_URL: 'http://evilginx-bridge:9000', EVILGINX_BRIDGE_TOKEN: 'a'.repeat(64) }).evilginx?.apiUrl).toBe('http://evilginx-bridge:9000');
  });
});
