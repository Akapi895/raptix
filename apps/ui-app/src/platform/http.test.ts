import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createHttp, HttpError } from './http';
import { createEvents } from './events';

describe('HTTP boundary', () => {
  it('preserves Go query names, attaches the session and validates the response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ total: 3 }));
    const client = createHttp({
      baseURL: 'https://backend.example.com/', fetcher,
      session: { read: () => ({ token: 'session-token' }), clear: vi.fn() },
    });
    const result = await client.get('/api/projects', {
      query: { project_id: 'project & one', limit: 0, archived: false, omitted: undefined },
      schema: z.object({ total: z.number() }),
    });
    expect(result).toEqual({ total: 3 });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://backend.example.com/api/projects?project_id=project+%26+one&limit=0&archived=false');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer session-token');
  });

  it('clears expired sessions on 401 and emits one expiry event', async () => {
    const events = createEvents<{ 'session-expired': { url: string }; forbidden: { url: string } }>();
    const expired = vi.fn();
    events.on('session-expired', expired);
    const clear = vi.fn();
    const client = createHttp({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'expired' }, { status: 401 })),
      session: { read: () => ({ token: 'old' }), clear }, events,
    });
    await expect(client.get('/api/projects')).rejects.toMatchObject({ name: 'HttpError', status: 401, message: 'expired' });
    expect(clear).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledExactlyOnceWith({ url: '/api/projects' });
  });

  it('keeps the session on 403 and preserves the error details', async () => {
    const clear = vi.fn();
    const client = createHttp({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'permission denied' }, { status: 403 })),
      session: { read: () => ({ token: 'valid' }), clear },
    });
    await expect(client.get('/api/projects')).rejects.toBeInstanceOf(HttpError);
    expect(clear).not.toHaveBeenCalled();
  });

  it('rejects malformed Go DTOs at the decoder boundary', async () => {
    const client = createHttp({ fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ total: 'three' })) });
    await expect(client.get('/api/projects', { schema: z.object({ total: z.number() }) })).rejects.toBeInstanceOf(z.ZodError);
  });

  it('passes cancellation through and never sends a token to public endpoints', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createHttp({ fetcher, session: { read: () => ({ token: 'private' }), clear: vi.fn() } });
    await client.post('/api/auth/login', { username: 'admin', password: 'test' }, { auth: false, signal: controller.signal });
    const [, init] = fetcher.mock.calls[0]!;
    expect(init?.signal).toBe(controller.signal);
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe('{"username":"admin","password":"test"}');
  });
});
