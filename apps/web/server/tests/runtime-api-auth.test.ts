import { afterEach, expect, it, vi } from 'vitest';
import { loadRuntimeApiToken, RUNTIME_API_TOKEN_FILE } from '../src/config/runtime-api-token.js';
import { RuntimeReadClient } from '../src/integrations/runtime/read-client.js';

/**
 * The LangGraph API refuses callers without the runtime token (interfaces/api/auth.py). The web API must hold the token
 * and present it on every runtime call, and it must not start without it.
 */

const TOKEN = 'runtime-api-token-0123456789abcdef';

afterEach(() => { vi.unstubAllGlobals(); });

it('refuses to start without a runtime token file of at least 32 bytes', () => {
  expect(() => loadRuntimeApiToken({}, () => TOKEN)).toThrow(RUNTIME_API_TOKEN_FILE);
  expect(() => loadRuntimeApiToken({ [RUNTIME_API_TOKEN_FILE]: '/run/secrets/runtime-api-token' }, () => 'short')).toThrow(/32 bytes/);
  expect(loadRuntimeApiToken({ [RUNTIME_API_TOKEN_FILE]: '/run/secrets/runtime-api-token' }, () => `${TOKEN}\n`)).toBe(TOKEN);
});

it('presents the runtime token as a bearer header on every runtime read', async () => {
  const seen: (string | undefined)[] = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string> | undefined)?.authorization);
    return new Response(null, { status: 200 });
  });
  const client = new RuntimeReadClient('http://web-runtime:2024', 1000, 1000, TOKEN);
  expect(await client.threadExists('thread-1')).toBe(true);
  expect(seen).toEqual([`Bearer ${TOKEN}`]);
});

it('sends no authorization header when no token is configured, so the runtime answers 401 and the caller fails closed', async () => {
  const seen: (string | undefined)[] = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string> | undefined)?.authorization);
    return new Response(null, { status: 401 });
  });
  await expect(new RuntimeReadClient('http://web-runtime:2024', 1000, 1000).threadExists('thread-1')).rejects.toMatchObject({ statusCode: 503 });
  expect(seen).toEqual([undefined]);
});
