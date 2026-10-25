import { expect, it } from 'vitest';
import { SandboxController, SandboxProvisionError } from '../src/integrations/sandboxes/sandbox-controller-client.js';
import { sandboxTokenFor } from '../src/services/runtime/sandbox-routing.js';

const TOKEN = 'controller-token-0123456789abcdef';
const KEY = '0123456789abcdef0123456789abcdef';

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

it('asks the host controller for one project sandbox with the bearer token and resolves when it is ready', async () => {
  const { fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ status: 'ready' }), { status: 200 }));
  await new SandboxController('http://host.docker.internal:9200', TOKEN, fetchImpl).ensure('lab-a');
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe('http://host.docker.internal:9200/v1/sandboxes/ensure');
  expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ slug: 'lab-a' });
});

it('turns a refusal into a 503 that carries no controller detail', async () => {
  const { fetchImpl } = fakeFetch(() => new Response(JSON.stringify({ error: 'provision_failed' }), { status: 503 }));
  const attempt = new SandboxController('http://127.0.0.1:9200', TOKEN, fetchImpl).ensure('lab-a');
  await expect(attempt).rejects.toBeInstanceOf(SandboxProvisionError);
  await expect(attempt).rejects.toMatchObject({ statusCode: 503 });
  await expect(attempt).rejects.toMatchObject({ message: expect.not.stringContaining('provision_failed') });
});

it('treats an unreachable controller or an unexpected answer as a provisioning failure', async () => {
  const unreachable = new SandboxController('http://127.0.0.1:9200', TOKEN, (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
  await expect(unreachable.ensure('lab-a')).rejects.toMatchObject({ statusCode: 503 });
  const { fetchImpl } = fakeFetch(() => new Response('{"status":"starting"}', { status: 200 }));
  await expect(new SandboxController('http://127.0.0.1:9200', TOKEN, fetchImpl).ensure('lab-a')).rejects.toMatchObject({ statusCode: 503 });
});

it('refuses a controller address that is not loopback or host.docker.internal', () => {
  expect(() => new SandboxController('http://10.0.0.5:9200', TOKEN)).toThrow();
  expect(() => new SandboxController('http://127.0.0.1:9200', 'short')).toThrow();
});

// The same vector is asserted by apps/launcher/internal/sandboxes/secrets_test.go.
it('derives the same sandbox token as the launcher, and a distinct one per project', () => {
  expect(sandboxTokenFor(KEY, 'lab-a')).toBe('3b5d7e4b801cb8f017ef2e4d1037d3d8780b6675e37baac28ba6bf9be04f50a3');
  expect(sandboxTokenFor(KEY, 'lab-a')).not.toBe(sandboxTokenFor(KEY, 'lab-b'));
});
