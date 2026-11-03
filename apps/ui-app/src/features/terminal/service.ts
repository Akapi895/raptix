import type { SocketPort } from '../../platform/ws';

export interface TerminalConnectionOptions {
  url(): string;
  factory(url: string): SocketPort;
  output(data: string | Uint8Array): void;
  opened?(): void;
  closed(): void;
  error(error?: unknown): void;
}

export function buildTerminalURL(location: { protocol: string; host: string }, token?: string | null): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/terminal/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;
}

/** One PTY per tab; queue initial input, but never replay it into a replacement PTY. */
export function createTerminalConnection(options: TerminalConnectionOptions) {
  let socket: SocketPort | undefined;
  let detach: (() => void) | undefined;
  let disposed = false;
  let generation = 0;
  let size = { cols: 80, rows: 24 };
  let queue: string[] = [];
  let messages = Promise.resolve();
  const report = (error: unknown) => { if (!disposed) options.error(error); };
  function connect(): void {
    if (disposed || (socket && socket.readyState < 2)) return;
    detach?.(); queue = [];
    const ownGeneration = ++generation;
    try {
      const ws = options.factory(options.url());
      socket = ws;
      const current = () => !disposed && generation === ownGeneration;
      const open = () => {
        if (!current()) return;
        try {
          ws.send(JSON.stringify({ type: 'resize', ...size }));
          while (queue.length && ws.readyState === 1) ws.send(queue.shift()!);
          options.opened?.();
        } catch (error) { report(error); }
      };
      const message = (event: Event) => {
        const data: unknown = (event as MessageEvent<unknown>).data;
        // Serialize Blob conversion with subsequent text/binary frames.
        messages = messages.then(async () => {
          if (!current()) return;
          const output = data instanceof Blob ? new Uint8Array(await data.arrayBuffer())
            : data instanceof ArrayBuffer ? new Uint8Array(data) : typeof data === 'string' ? data : undefined;
          if (current() && output !== undefined) options.output(output);
        }).catch(error => { if (current()) report(error); });
      };
      const close = () => {
        queue = [];
        messages = messages.then(() => { if (current()) options.closed(); }).catch(report);
      };
      const error = (event: Event) => { if (current()) report(event); };
      ws.addEventListener('open', open);
      ws.addEventListener('message', message);
      ws.addEventListener('close', close);
      ws.addEventListener('error', error);
      detach = () => {
        ws.removeEventListener('open', open); ws.removeEventListener('message', message);
        ws.removeEventListener('close', close); ws.removeEventListener('error', error);
      };
      if (ws.readyState === 1) open();
    } catch (error) { socket = undefined; report(error); }
  }
  return {
    connect,
    send(data: string): void {
      if (disposed) return;
      connect();
      try {
        if (socket?.readyState === 1) socket.send(data);
        else if (socket?.readyState === 0) {
          if (queue.length >= 256) throw new Error('WebSocket send queue is full');
          queue.push(data);
        }
      } catch (error) { report(error); }
    },
    resize(cols: number, rows: number): void {
      if (disposed || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 65535 || rows > 65535) return;
      size = { cols, rows };
      if (socket?.readyState === 1) {
        try { socket.send(JSON.stringify({ type: 'resize', ...size })); } catch (error) { report(error); }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true; generation++; queue = []; detach?.();
      if (socket && socket.readyState < 2) socket.close(1000, 'Client closed');
      socket = undefined;
    },
  };
}
