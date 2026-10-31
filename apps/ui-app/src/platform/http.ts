import { session } from './session';
import { transportEvents } from './events';

export interface Decoder<T> { parse(value: unknown): T }
export type Query = Record<string, string | number | boolean | null | undefined>;
export interface RequestOptions<T> extends Omit<RequestInit, 'body'> {
  query?: Query;
  schema?: Decoder<T>;
  auth?: boolean;
}

interface SessionPort {
  read(): { token: string } | null;
  clear(): void;
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string, public readonly body: unknown) {
    const detail = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
    this.name = 'HttpError';
  }
}

export function createHttp(config: {
  baseURL?: string;
  fetcher?: typeof fetch;
  session?: SessionPort;
  events?: { emit(type: 'session-expired' | 'forbidden', detail: { url: string }): void };
} = {}) {
  const sessions = config.session ?? session;
  const events = config.events ?? transportEvents;

  async function raw(path: string, init: RequestInit = {}, options: { auth?: boolean; query?: Query } = {}): Promise<Response> {
    const base = (config.baseURL ?? '').replace(/\/$/, '');
    const target = base + path;
    const url = new URL(target, 'http://relative.invalid');
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const address = base ? url.href : url.pathname + url.search + url.hash;
    const headers = new Headers(init.headers);
    const token = options.auth !== false ? sessions.read()?.token : undefined;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // Resolve global fetch at request time: the dev entry installs it after imports.
    const response = await (config.fetcher ?? globalThis.fetch)(address, { ...init, headers });
    if (response.status === 401 && options.auth !== false) {
      sessions.clear();
      events.emit('session-expired', { url: path });
    } else if (response.status === 403) {
      events.emit('forbidden', { url: path });
    }
    return response;
  }

  async function request<T>(method: string, path: string, body: unknown, options: RequestOptions<T> = {}): Promise<T> {
    const { query, schema, auth, ...init } = options;
    const headers = new Headers(init.headers);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await raw(path, {
      ...init, method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }, { query, auth });
    const text = await response.text();
    let value: unknown;
    try { value = text ? JSON.parse(text) : undefined; } catch { value = text; }
    if (!response.ok) throw new HttpError(response.status, path, value);
    // Callers of unvalidated, transitional endpoints supply an explicit Go DTO.
    // Important clients pass a decoder and never trust a generic assertion.
    return schema ? schema.parse(value) : value as T;
  }

  return {
    raw,
    get: <T>(path: string, options?: RequestOptions<T>) => request<T>('GET', path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: RequestOptions<T>) => request<T>('POST', path, body, options),
    put: <T>(path: string, body?: unknown, options?: RequestOptions<T>) => request<T>('PUT', path, body, options),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions<T>) => request<T>('PATCH', path, body, options),
    delete: <T>(path: string, options?: RequestOptions<T>) => request<T>('DELETE', path, undefined, options),
  };
}

export const http = createHttp({ baseURL: import.meta.env.VITE_API_BASE });
