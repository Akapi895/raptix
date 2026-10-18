import { describe, expect, it } from 'vitest';
import { C2Service } from '../src/services/c2-service.js';

const session = { id: 'session-1', name: 'lab-agent', hostname: 'lab-host', username: 'svc', os: 'linux', arch: 'amd64', transport: 'mtls', remoteAddress: '172.31.0.9', activeC2: 'mtls://c2:8888', version: '1.5.42', pid: 42, lastCheckin: 1, listenerPort: 8888, isDead: false };

function provider(sessions: unknown[]) {
  return { call: async (body: Record<string, unknown>) => {
    if (body.op === 'sessions.list') return { sessions };
    throw new Error(`unexpected op ${String(body.op)}`);
  } };
}

describe('C2 grant verification (P12)', () => {
  it('accepts a session the provider reports in this engagement namespace', async () => {
    const service = new C2Service({} as never, provider([session]) as never);
    await expect(service.assertSessionReported('eng', 'session-1')).resolves.toBeUndefined();
  });

  it('refuses a session the provider does not report, instead of recording a grant for it', async () => {
    const service = new C2Service({} as never, provider([session]) as never);
    await expect(service.assertSessionReported('eng', 'sess-live-check')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses when no provider is configured, rather than assuming the session exists', async () => {
    const service = new C2Service({} as never);
    const failure = service.assertSessionReported('eng', 'session-1');
    await expect(failure).rejects.toMatchObject({ statusCode: 503 });
  });
});
