export interface SocketPort {
  readonly readyState: number;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export function connectSocket(url: string, options: {
  factory?: (url: string) => SocketPort;
  signal?: AbortSignal;
  maxQueued?: number;
  onMessage?: (event: MessageEvent<unknown>) => void;
  onError?: (event: Event) => void;
  onClose?: (event: Event) => void;
} = {}) {
  const socket = options.factory?.(url) ?? new WebSocket(url);
  const queue: Parameters<SocketPort['send']>[0][] = [];
  let closed = false;
  function send(data: Parameters<SocketPort['send']>[0]): void {
    if (closed || socket.readyState >= 2) throw new Error('WebSocket is closed');
    if (socket.readyState === 1) socket.send(data);
    else {
      if (queue.length >= (options.maxQueued ?? 256)) throw new Error('WebSocket send queue is full');
      queue.push(data);
    }
  }
  const open = () => { while (queue.length && socket.readyState === 1) socket.send(queue.shift()!); };
  const message = (event: Event) => options.onMessage?.(event as MessageEvent<unknown>);
  const error = (event: Event) => options.onError?.(event);
  function dispose(): void {
    closed = true;
    queue.length = 0;
    socket.removeEventListener('open', open);
    socket.removeEventListener('message', message);
    socket.removeEventListener('error', error);
    socket.removeEventListener('close', onClose);
    options.signal?.removeEventListener('abort', close);
  }
  const onClose = (event: Event) => { dispose(); options.onClose?.(event); };
  function close(): void {
    if (closed) return;
    dispose();
    if (socket.readyState < 2) socket.close(1000, 'Client closed');
  }
  socket.addEventListener('open', open);
  socket.addEventListener('message', message);
  socket.addEventListener('error', error);
  socket.addEventListener('close', onClose);
  options.signal?.addEventListener('abort', close, { once: true });
  if (options.signal?.aborted) close();
  return {
    send, close,
    resize(cols: number, rows: number): void {
      // internal/handler/terminal.go owns the terminal handler; its Unix WS
      // implementation (terminal_ws_unix.go:terminalResize) uses uint16.
      // Wire shape matches web/static/js/terminal.js, including text JSON frames.
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 65535 || rows > 65535) throw new Error('Invalid terminal dimensions');
      send(JSON.stringify({ type: 'resize', cols, rows }));
    },
    get readyState() { return socket.readyState; },
  };
}
