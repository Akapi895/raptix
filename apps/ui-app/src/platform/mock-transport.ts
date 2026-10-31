// Browser-only interception. The dispatcher and socket implementation are injected;
// this layer has no dependency on fixtures, routes, or application features.
export interface TransportRequest {
  method: string; url: string; body: unknown; headers: Record<string, string>; signal: AbortSignal | null;
}
export interface StreamEvent { type: string; message: string; data: object; __delay?: number }
export type StreamProducer = (emit: (event: StreamEvent) => void, stopped: () => boolean) => void | Promise<void>;
export interface StreamOptions { signal?: AbortSignal | null; delayMs?: number }
export type DispatchResult =
  | { status: number; body: unknown }
  | { status: number; raw: string; contentType: string; filename?: string }
  | { status: number; stream: { events: StreamEvent[] | StreamProducer; opts: StreamOptions } };
export interface MockSocketConnection { send(data: string): void; close(): void }
export interface MockTransportOptions {
  dispatch: (request: TransportRequest) => Promise<DispatchResult>;
  connectSocket: (url: URL, emit: (text: string) => void) => MockSocketConnection;
  eventSourceHeartbeat: () => unknown;
  reset: () => void;
  debug?: boolean;
}

export function buildMockResponse(result: DispatchResult, debug = false): Response {
  if ('stream' in result) {
    const { events, opts } = result.stream;
    const encoder = new TextEncoder();
    let closed = false;
    let finish = (): void => { closed = true; };
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        const signal = opts.signal;
        const stopped = (): boolean => closed || !!signal?.aborted;
        finish = (): void => {
          if (closed) return;
          closed = true;
          signal?.removeEventListener('abort', finish);
          try { controller.close(); } catch { /* reader cancelled */ }
        };
        const emit = (event: StreamEvent): void => {
          if (stopped()) return;
          if (debug) console.log('[csai-mock] sse', event.type, event.message ? String(event.message).slice(0, 60) : '');
          controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'));
        };
        signal?.addEventListener('abort', finish, { once: true });
        void (async () => {
          try {
            if (typeof events === 'function') { if (!stopped()) await events(emit, stopped); }
            else for (const event of events) {
              if (stopped()) break;
              await new Promise<void>(resolve => setTimeout(resolve, event.__delay ?? opts.delayMs ?? 120));
              const payload = { ...event };
              delete payload.__delay;
              emit(payload);
            }
            finish();
          } catch (error) { if (!closed) { closed = true; controller.error(error); } }
        })();
      },
      cancel() { finish(); },
    });
    return new Response(readable, { status: result.status, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  }
  if ('raw' in result) {
    const headers = new Headers({ 'Content-Type': result.contentType });
    if (result.filename) headers.set('Content-Disposition', 'attachment; filename="' + result.filename + '"');
    return new Response(result.raw, { status: result.status, headers });
  }
  return new Response(JSON.stringify(result.body ?? {}), { status: result.status, headers: { 'Content-Type': 'application/json' } });
}

export function mockBrowserEnvironment() {
  // Accessing localStorage itself can throw, before getItem is called.
  const storage = {
    getItem(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return null; } },
    setItem(key: string, value: string): void { try { window.localStorage.setItem(key, value); } catch { /* blocked or full */ } },
    removeItem(key: string): void { try { window.localStorage.removeItem(key); } catch { /* blocked */ } },
  };
  return { storage, forceReset: /(^|[?&])mock-reset(=|&|$)/.test(window.location.search) };
}

export function installMockTransport(options: MockTransportOptions): () => void {
  const originalFetch = window.fetch.bind(window);
  const OriginalXHR = window.XMLHttpRequest;
  const OriginalWebSocket = window.WebSocket;
  const OriginalEventSource = window.EventSource;
  const isApi = (url: string): boolean => { try { const parsed = new URL(url, window.location.origin); return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/'); } catch { return false; } };
  const headersOf = (headers?: HeadersInit): Record<string, string> => { const out: Record<string, string> = {}; new Headers(headers).forEach((value, key) => { out[key] = value; }); return out; };

  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isApi(url)) return originalFetch(input, init);
    const request = input instanceof Request ? input : undefined;
    const body = init?.body !== undefined ? init.body : request && !['GET', 'HEAD'].includes(request.method) ? await request.clone().text() : null;
    return buildMockResponse(await options.dispatch({ method: (init?.method || request?.method || 'GET').toUpperCase(), url, body, headers: headersOf(init?.headers ?? request?.headers), signal: init?.signal ?? request?.signal ?? null }), options.debug);
  };

  class MockXHR extends OriginalXHR {
    private mocked = false;
    private method = 'GET';
    private address = '';
    private headers: Record<string, string> = {};
    private mockState = 0;
    private mockStatus = 0;
    private mockText = '';
    private progressTimer?: ReturnType<typeof setInterval>;
    private cancelled = false;
    override get readyState(): number { return this.mocked ? this.mockState : super.readyState; }
    override get status(): number { return this.mocked ? this.mockStatus : super.status; }
    override get responseText(): string { return this.mocked ? this.mockText : super.responseText; }
    override get response(): unknown { return this.mocked ? this.mockText : super.response; }
    override open(method: string, url: string | URL, async = true, username?: string | null, password?: string | null): void {
      this.address = String(url); this.method = method.toUpperCase(); this.mocked = isApi(this.address);
      this.headers = {}; this.cancelled = false;
      if (!this.mocked) { super.open(method, url, async, username, password); return; }
      this.mockState = 1; this.dispatchEvent(new Event('readystatechange'));
    }
    override setRequestHeader(name: string, value: string): void { if (this.mocked) this.headers[name.toLowerCase()] = value; else super.setRequestHeader(name, value); }
    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (!this.mocked) { super.send(body); return; }
      const total = body instanceof Blob ? body.size : 1024;
      let step = 0;
      this.progressTimer = setInterval(() => {
        this.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: Math.min(total, Math.round(total * ++step / 4)), total }));
        if (step < 4) return;
        clearInterval(this.progressTimer);
        void options.dispatch({ method: this.method, url: this.address, body, headers: this.headers, signal: null }).then(async result => {
          if (this.cancelled) return;
          this.mockStatus = result.status;
          this.mockText = await buildMockResponse(result).text();
          this.mockState = 4;
          this.dispatchEvent(new Event('readystatechange')); this.dispatchEvent(new ProgressEvent('load')); this.dispatchEvent(new ProgressEvent('loadend'));
        }).catch(() => { if (!this.cancelled) this.dispatchEvent(new ProgressEvent('error')); });
      }, 120);
    }
    override abort(): void { if (!this.mocked) { super.abort(); return; } this.cancelled = true; clearInterval(this.progressTimer); this.mockState = 0; this.dispatchEvent(new ProgressEvent('abort')); }
    override getResponseHeader(name: string): string | null { return this.mocked ? null : super.getResponseHeader(name); }
    override getAllResponseHeaders(): string { return this.mocked ? '' : super.getAllResponseHeaders(); }
  }
  window.XMLHttpRequest = MockXHR;

  // EventTarget-backed mocks support both on* and addEventListener consumers.
  class MockSocket extends EventTarget implements WebSocket {
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
    readonly bufferedAmount = 0; readonly extensions = ''; readonly protocol = '';
    binaryType: BinaryType = 'blob'; readyState: number = 0;
    onopen: WebSocket['onopen'] = null; onmessage: WebSocket['onmessage'] = null; onclose: WebSocket['onclose'] = null; onerror: WebSocket['onerror'] = null;
    private connection: MockSocketConnection;
    constructor(readonly url: string) {
      super();
      this.connection = options.connectSocket(new URL(url.replace(/^ws/, 'http'), window.location.origin), text => {
        if (this.readyState !== 1) return;
        const event = new MessageEvent('message', { data: text }); this.onmessage?.call(this, event); this.dispatchEvent(event);
      });
      setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; const event = new Event('open'); this.onopen?.call(this, event); this.dispatchEvent(event); this.connection.send(''); }, 120);
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void { this.connection.send(String(data)); }
    close(code = 1000, reason = ''): void { if (this.readyState === 3) return; this.readyState = 3; this.connection.close(); const event = new CloseEvent('close', { code, reason }); this.onclose?.call(this, event); this.dispatchEvent(event); }
  }
  // A constructor Proxy preserves the native constructor's complete static type.
  window.WebSocket = new Proxy(OriginalWebSocket, { construct(target, args: ConstructorParameters<typeof WebSocket>) {
    const [url, protocols] = args; const parsed = new URL(String(url).replace(/^ws/, 'http'), window.location.origin);
    return parsed.pathname.startsWith('/api/') ? new MockSocket(parsed.href) : new target(url, protocols);
  } });

  class MockEvents extends EventTarget implements EventSource {
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2; readonly withCredentials = false;
    readyState: number = 0; onopen: EventSource['onopen'] = null; onmessage: EventSource['onmessage'] = null; onerror: EventSource['onerror'] = null;
    private timer: ReturnType<typeof setInterval>;
    private readonly listeners = new Map<EventListenerOrEventListenerObject | ((this: EventSource, event: MessageEvent<unknown>) => unknown), Map<string, EventListener>>();
    override addEventListener<K extends keyof EventSourceEventMap>(type: K, listener: (this: EventSource, event: EventSourceEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;
    override addEventListener(type: string, listener: (this: EventSource, event: MessageEvent<unknown>) => unknown, options?: boolean | AddEventListenerOptions): void;
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | ((this: EventSource, event: MessageEvent<unknown>) => unknown) | null, options?: boolean | AddEventListenerOptions): void {
      if (!listener) return;
      const types = this.listeners.get(listener) ?? new Map<string, EventListener>();
      if (types.has(type)) return;
      const wrapped: EventListener = event => { if (typeof listener === 'function') listener.call(this, event instanceof MessageEvent ? event : new MessageEvent(event.type)); else listener.handleEvent(event); };
      types.set(type, wrapped); this.listeners.set(listener, types); super.addEventListener(type, wrapped, options);
    }
    override removeEventListener<K extends keyof EventSourceEventMap>(type: K, listener: (this: EventSource, event: EventSourceEventMap[K]) => unknown, options?: boolean | EventListenerOptions): void;
    override removeEventListener(type: string, listener: (this: EventSource, event: MessageEvent<unknown>) => unknown, options?: boolean | EventListenerOptions): void;
    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | ((this: EventSource, event: MessageEvent<unknown>) => unknown) | null, options?: boolean | EventListenerOptions): void {
      if (!listener) return;
      const wrapped = this.listeners.get(listener)?.get(type);
      if (wrapped) super.removeEventListener(type, wrapped, options);
      this.listeners.get(listener)?.delete(type);
    }
    constructor(readonly url: string) {
      super();
      this.timer = setInterval(() => { if (this.readyState !== 1) return; const event = new MessageEvent('message', { data: JSON.stringify(options.eventSourceHeartbeat()) }); this.onmessage?.call(this, event); this.dispatchEvent(event); }, 15000);
      setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; const event = new Event('open'); this.onopen?.call(this, event); this.dispatchEvent(event); }, 80);
    }
    close(): void { this.readyState = 2; clearInterval(this.timer); }
  }
  window.EventSource = new Proxy(OriginalEventSource, { construct(target, args: ConstructorParameters<typeof EventSource>) {
    const [url, init] = args; const parsed = new URL(String(url), window.location.origin);
    return parsed.pathname.startsWith('/api/') ? new MockEvents(parsed.href) : new target(url, init);
  } });

  const mountBadge = (): void => {
    if (document.getElementById('csai-mock-badge')) return;
    const badge = document.createElement('div'); badge.id = 'csai-mock-badge'; badge.setAttribute('role', 'status');
    badge.style.cssText = 'position:fixed;left:12px;bottom:var(--demo-badge-bottom, 12px);z-index:2147483000;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:rgba(20,24,33,.92);color:#e8edf7;font:12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.25)';
    const label = document.createElement('span'); label.textContent = 'Demo data · fictional';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Reset'; button.style.cssText = 'background:#c62828;color:#fff;border:0;border-radius:999px;padding:3px 9px;cursor:pointer;font:inherit';
    button.addEventListener('click', () => { options.reset(); try { window.localStorage.removeItem('raptix-auth'); } catch { /* blocked */ } window.location.reload(); });
    badge.append(label, button); document.body.append(badge);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBadge, { once: true }); else mountBadge();
  return () => {
    window.fetch = originalFetch; window.XMLHttpRequest = OriginalXHR; window.WebSocket = OriginalWebSocket; window.EventSource = OriginalEventSource;
    document.removeEventListener('DOMContentLoaded', mountBadge); document.getElementById('csai-mock-badge')?.remove();
  };
}
