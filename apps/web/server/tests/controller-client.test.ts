import { describe, expect, it } from 'vitest';
import { ControllerRefusedError, ControllerUnavailableError, HostControllerClient } from '../src/integrations/environments/controller-client.js';

const TOKEN = 'controller-token-with-more-than-32-bytes';
const identity = { deploymentId: 'deploy-1', projectId: 'proj-alpha', environmentId: 'env-alpha', role: 'runtime' as const, generation: 1 };

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond(String(input), init ?? {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('HostControllerClient', () => {
  it('sends one allowlisted operation with the bearer token and returns the observation', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(200, { status: 'ok', observation: { name: 'raptix-env-x-runtime', exists: true, running: true, generation: 1 } }));
    const client = new HostControllerClient('http://127.0.0.1:9100', TOKEN, fetchImpl);
    const observation = await client.call('start', { identity });
    expect(observation).toEqual({ name: 'raptix-env-x-runtime', exists: true, running: true, generation: 1 });
    expect(calls[0]?.url).toBe('http://127.0.0.1:9100/v1/environments/start');
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.init.redirect).toBe('error');
  });

  it('maps a stable refusal code without passing on any other text', async () => {
    const { fetchImpl } = fakeFetch(() => json(409, { error: 'foreign_resource' }));
    const client = new HostControllerClient('http://127.0.0.1:9100', TOKEN, fetchImpl);
    const failure = await client.call('ensure', { identity }).catch(error => error);
    expect(failure).toBeInstanceOf(ControllerRefusedError);
    expect((failure as ControllerRefusedError).code).toBe('foreign_resource');
    expect(String((failure as Error).message)).not.toContain(TOKEN);
  });

  it('treats an unknown, malformed or oversized answer as an unavailable outcome', async () => {
    const cases: Response[] = [
      new Response('<html>bad gateway</html>', { status: 502 }),
      json(200, { status: 'ok', observation: { name: 'x' } }),
      new Response('x'.repeat(70 * 1024), { status: 200 }),
      json(500, { error: 'Error: No such container: secret-path' }),
    ];
    for (const response of cases) {
      const { fetchImpl } = fakeFetch(() => response);
      const client = new HostControllerClient('http://127.0.0.1:9100', TOKEN, fetchImpl);
      await expect(client.call('observe', { identity })).rejects.toBeInstanceOf(ControllerUnavailableError);
    }
  });

  it('gives up after the timeout and reports the outcome as unknown', async () => {
    const fetchImpl = ((_: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
    const client = new HostControllerClient('http://127.0.0.1:9100', TOKEN, fetchImpl, 20);
    await expect(client.call('stop', { identity, stopTimeoutSeconds: 5 })).rejects.toBeInstanceOf(ControllerUnavailableError);
  });

  it('refuses a non-loopback controller address and a short token before any request', () => {
    expect(() => new HostControllerClient('http://10.0.0.5:9100', TOKEN)).toThrow(/loopback/);
    expect(() => new HostControllerClient('http://localhost:9100', TOKEN)).toThrow(/loopback/);
    expect(() => new HostControllerClient('http://127.0.0.1:9100', 'short')).toThrow(/32 bytes/);
  });
});
