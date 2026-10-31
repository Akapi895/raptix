import { describe, expect, it, vi } from 'vitest';
import { connectSocket, type SocketPort } from './ws';

class TestSocket extends EventTarget implements SocketPort {
  readyState = 0;
  send = vi.fn<SocketPort['send']>();
  close = vi.fn<SocketPort['close']>(() => { this.readyState = 2; });
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
}

describe('WebSocket lifecycle', () => {
  it('flushes queued input and resize in order, then sends directly', () => {
    const socket = new TestSocket();
    const connection = connectSocket('/terminal', { factory: () => socket, maxQueued: 2 });
    connection.send('pwd\r');
    connection.resize(120, 40);
    expect(() => connection.send('overflow')).toThrow('queue is full');
    expect(socket.send).not.toHaveBeenCalled();
    socket.open();
    connection.send('next');
    expect(socket.send.mock.calls).toEqual([['pwd\r'], ['{"type":"resize","cols":120,"rows":40}'], ['next']]);
    connection.close();
  });

  it('disposes once, drops pending input and detaches callbacks and abort', () => {
    const socket = new TestSocket();
    const controller = new AbortController();
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const connection = connectSocket('/terminal', { factory: () => socket, signal: controller.signal, onMessage, onError, onClose });
    connection.send('pending');
    connection.close();
    connection.close();
    controller.abort();
    socket.open();
    socket.dispatchEvent(new MessageEvent('message', { data: 'late' }));
    socket.dispatchEvent(new Event('error'));
    socket.dispatchEvent(new Event('close'));
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(1000, 'Client closed');
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(() => connection.send('late')).toThrow('closed');
  });

  it('forwards live events and disposes on remote close without closing again', () => {
    const socket = new TestSocket();
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const connection = connectSocket('/terminal', { factory: () => socket, onMessage, onError, onClose });
    const message = new MessageEvent('message', { data: new Uint8Array([1, 2]).buffer });
    socket.dispatchEvent(message);
    socket.dispatchEvent(new Event('error'));
    socket.readyState = 3;
    socket.dispatchEvent(new Event('close'));
    socket.dispatchEvent(new Event('close'));
    connection.close();
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(message);
    expect(onError).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(socket.close).not.toHaveBeenCalled();
    expect(() => connection.send('late')).toThrow('closed');
  });

  it.each([false, true])('closes on abort (already aborted: %s)', (alreadyAborted) => {
    const socket = new TestSocket();
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const connection = connectSocket('/terminal', { factory: () => socket, signal: controller.signal });
    if (!alreadyAborted) controller.abort();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(() => connection.send('input')).toThrow('closed');
  });

  it.each([[0, 24], [80, -1], [1.5, 24], [80, NaN], [65536, 24], [80, Infinity]])('rejects dimensions %s x %s before sending', (cols, rows) => {
    const socket = new TestSocket();
    const connection = connectSocket('/terminal', { factory: () => socket });
    expect(() => connection.resize(cols, rows)).toThrow('dimensions');
    socket.open();
    expect(socket.send).not.toHaveBeenCalled();
    connection.resize(65535, 1);
    expect(socket.send).toHaveBeenCalledWith('{"type":"resize","cols":65535,"rows":1}');
    connection.close();
  });
});
