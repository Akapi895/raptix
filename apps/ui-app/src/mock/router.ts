import { z } from 'zod';
import type { DispatchResult, TransportRequest, StreamEvent, StreamProducer, StreamOptions } from '../platform/mock-transport';

class RouteParams {
  constructor(private readonly values: Record<string, string>) {}
  private get(key: string): string { const value = this.values[key]; if (value === undefined) throw new Error('Missing route parameter: ' + key); return value; }
  get id(): string { return this.get('id'); }
  get name(): string { return this.get('name'); }
  get conversationId(): string { return this.get('conversationId'); }
  get queueId(): string { return this.get('queueId'); }
  get taskId(): string { return this.get('taskId'); }
  get factId(): string { return this.get('factId'); }
  get edgeId(): string { return this.get('edgeId'); }
  get filename(): string { return this.get('filename'); }
  get runId(): string { return this.get('runId'); }
  get inspectionId(): string { return this.get('inspectionId'); }
  get importId(): string { return this.get('importId'); }
}
export interface Context<B = unknown> {
  method: string; path: string; params: RouteParams; query: URLSearchParams;
  body: B; headers: Record<string, string>; signal: AbortSignal | null;
}
interface Route {
  method: string; pattern: string; re: RegExp; keys: string[];
  handler: (ctx: Context) => DispatchResult | Promise<DispatchResult>;
}
export const json = <T>(status: number, body: T) => ({ status, body });
export function ok(): { status: number; body: { success: boolean } };
export function ok<T>(body: T): { status: number; body: T };
export function ok(body: unknown = { success: true }): DispatchResult { return { status: 200, body }; }
export const fail = (status: number, error: string) => json(status, { error });
export const blob = (raw: string, contentType = 'application/octet-stream', filename = '') => ({ status: 200, raw, contentType, filename });
export const sse = (events: StreamEvent[] | StreamProducer, opts: StreamOptions = {}) => ({ status: 200, stream: { events, opts } });

export class MockRouter {
  readonly routes: Route[] = [];
  readonly unhandled: string[] = [];
  debug = false;
  constructor(private readonly delayMs?: number) {}

  route(method: string, pattern: string, handler: (ctx: Context) => DispatchResult | Promise<DispatchResult>): void;
  route<B>(method: string, pattern: string, schema: z.ZodType<B>, handler: (ctx: Context<B>) => DispatchResult | Promise<DispatchResult>): void;
  route<B>(method: string, pattern: string, schemaOrHandler: z.ZodType<B> | ((ctx: Context) => DispatchResult | Promise<DispatchResult>), typedHandler?: (ctx: Context<B>) => DispatchResult | Promise<DispatchResult>): void {
    const keys: string[] = [];
    const source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/:([A-Za-z0-9_]+)/g, (_, key: string) => { keys.push(key); return '/([^/]+)'; });
    const handler = (ctx: Context): DispatchResult | Promise<DispatchResult> => {
      if (typeof schemaOrHandler === 'function') return schemaOrHandler(ctx);
      const parsed = schemaOrHandler.safeParse(ctx.body ?? {});
      if (!parsed.success) return fail(400, 'Invalid request body');
      if (!typedHandler) return fail(500, 'Missing route handler');
      return typedHandler({ ...ctx, body: parsed.data });
    };
    this.routes.push({ method: method.toUpperCase(), pattern, re: new RegExp('^' + source + '$'), keys, handler });
  }

  async dispatch(request: TransportRequest): Promise<DispatchResult> {
    const parsed = new URL(request.url, 'http://mock.local');
    const method = request.method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.re.exec(parsed.pathname);
      if (!match) continue;
      if (this.debug) console.log('[csai-mock] ' + method + ' ' + parsed.pathname);
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => { params[key] = decodeURIComponent(match[index + 1] ?? ''); });
      let body: unknown = request.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* plain request text */ } }
      await new Promise<void>(resolve => setTimeout(resolve, this.delayMs ?? 60 + Math.floor(Math.random() * 120)));
      try {
        return await route.handler({ method, path: parsed.pathname, params: new RouteParams(params), query: parsed.searchParams, body, headers: request.headers, signal: request.signal });
      } catch (error) {
        console.error('[csai-mock] handler failed for ' + method + ' ' + parsed.pathname, error);
        return fail(500, error instanceof Error ? error.message : String(error));
      }
    }
    const key = method + ' ' + parsed.pathname;
    if (this.debug) console.log('[csai-mock] ' + key + ' (unhandled)');
    if (!this.unhandled.includes(key)) { this.unhandled.push(key); console.warn('[csai-mock] unhandled ' + key); }
    return ok({});
  }
}
