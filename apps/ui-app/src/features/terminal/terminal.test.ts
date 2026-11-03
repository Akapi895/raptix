import { describe, expect, it, vi } from 'vitest';
import type { SocketPort } from '../../platform/ws';
import { buildTerminalURL, createTerminalConnection } from './index';

class FakeSocket extends EventTarget implements SocketPort {
  readyState = 0;
  sent: Parameters<SocketPort['send']>[0][] = [];
  send = vi.fn((data: Parameters<SocketPort['send']>[0]) => { if (this.readyState !== 1) throw new Error('closed'); this.sent.push(data); });
  close = vi.fn(() => { this.readyState = 3; this.dispatchEvent(new Event('close')); });
  open(): void { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  message(data: unknown): void { this.dispatchEvent(new MessageEvent('message', { data })); }
}
function setup() {
  const sockets: FakeSocket[] = [];
  const output = vi.fn(), opened = vi.fn(), closed = vi.fn(), error = vi.fn();
  const url = vi.fn(() => 'wss://example.test/api/terminal/ws?token=secret');
  const factory = vi.fn(() => { const socket = new FakeSocket(); sockets.push(socket); return socket; });
  const connection = createTerminalConnection({ url, factory, output, opened, closed, error });
  return { connection, sockets, factory, output, opened, closed, error, url };
}
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
describe('terminal public connection', () => {
  it('constructs same-origin ws/wss URLs and safely encodes the current auth token', () => {
    expect(buildTerminalURL({ protocol: 'https:', host: 'example.test:443' }, 'a+b /?&')).toBe('wss://example.test:443/api/terminal/ws?token=a%2Bb%20%2F%3F%26');
    expect(buildTerminalURL({ protocol: 'http:', host: 'localhost:8080' })).toBe('ws://localhost:8080/api/terminal/ws');
  });
  it('connects immediately and sends latest dimensions before queued keystrokes on open', () => {
    const s = setup(); s.connection.connect();
    expect(s.factory).toHaveBeenCalledWith(s.url());
    s.connection.resize(90, 30); s.connection.send('a'); s.connection.resize(120, 40); s.connection.send('\r');
    expect(s.factory).toHaveBeenCalledTimes(1);
    const socket = s.sockets[0]!; socket.open();
    expect(socket.sent).toEqual(['{"type":"resize","cols":120,"rows":40}', 'a', '\r']);
    expect(s.opened).toHaveBeenCalledOnce();
  });
  it('sends text resize frames and rejects invalid/zero PTY dimensions', () => {
    const s = setup(); s.connection.connect(); const socket = s.sockets[0]!; socket.open();
    socket.sent = [];
    for (const [cols, rows] of [[0, 20], [20, -1], [1.5, 20], [65536, 20], [20, NaN]]) s.connection.resize(cols!, rows!);
    s.connection.resize(132, 43);
    expect(socket.sent).toEqual(['{"type":"resize","cols":132,"rows":43}']);
  });
  it('preserves text, UTF-8 binary, Blob ordering, and final output before the close notice', async () => {
    const s = setup(); s.connection.connect(); const socket = s.sockets[0]!;
    socket.message(new Blob(['first'])); socket.message('second'); socket.message(new TextEncoder().encode('\u7ec8\u7aef').buffer); socket.close();
    await flush();
    expect(s.output.mock.calls.map(([data]) => typeof data === 'string' ? data : new TextDecoder().decode(data as Uint8Array))).toEqual(['first', 'second', '\u7ec8\u7aef']);
    expect(s.closed).toHaveBeenCalledOnce();
    expect(s.closed.mock.invocationCallOrder[0]).toBeGreaterThan(s.output.mock.invocationCallOrder[2]!);
  });
  it('reconnects with fresh auth, drops dead-PTY input, and ignores stale socket events', async () => {
    const s = setup(); s.connection.send('old'); const old = s.sockets[0]!; old.close();
    s.url.mockReturnValue('ws://example.test/api/terminal/ws?token=new');
    s.connection.send('new'); const next = s.sockets[1]!; next.open();
    old.message('stale'); next.message('live'); await flush();
    expect(s.factory).toHaveBeenLastCalledWith('ws://example.test/api/terminal/ws?token=new');
    expect(next.sent).toEqual(['{"type":"resize","cols":80,"rows":24}', 'new']);
    expect(s.output).toHaveBeenCalledExactlyOnceWith('live');
    expect(s.closed).not.toHaveBeenCalled();
  });
  it('disposes socket/listeners and suppresses late async output and reconnect', async () => {
    const s = setup(); s.connection.connect(); const socket = s.sockets[0]!;
    socket.message(new Blob(['late'])); s.connection.dispose(); s.connection.dispose();
    socket.message('late text'); socket.dispatchEvent(new Event('error')); s.connection.send('ignored');
    await flush();
    expect(socket.close).toHaveBeenCalledOnce(); expect(s.factory).toHaveBeenCalledOnce();
    expect(s.output).not.toHaveBeenCalled(); expect(s.error).not.toHaveBeenCalled(); expect(s.closed).not.toHaveBeenCalled();
  });
  it('reports constructor and send failures without throwing from input/resize callbacks', () => {
    const s = setup(); s.factory.mockImplementationOnce(() => { throw new Error('no service'); });
    expect(() => s.connection.send('a')).not.toThrow(); expect(s.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'no service' }));
    s.connection.connect(); const socket = s.sockets[0]!; socket.open();
    socket.send.mockImplementation(() => { throw new Error('offline'); });
    expect(() => s.connection.send('b')).not.toThrow(); expect(() => s.connection.resize(100, 30)).not.toThrow();
    expect(s.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
  });
  it('bounds pending input and reports connection errors', () => {
    const s = setup(); for (let i = 0; i < 257; i++) s.connection.send('x');
    expect(s.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'WebSocket send queue is full' }));
    const event = new Event('error'); s.sockets[0]!.dispatchEvent(event); expect(s.error).toHaveBeenLastCalledWith(event);
  });
});
