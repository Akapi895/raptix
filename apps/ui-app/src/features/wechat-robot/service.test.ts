import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRuntime } from '../../platform/notification-browser';
import type { Request } from '../notifications';
import { createWechatClient } from './client';
import { createWechatService } from './service';
import type { WechatDependencies, WechatResponse } from './types';

const response = (body: WechatResponse, status = 200) => new Response(JSON.stringify(body), { status });
function setup() {
  vi.useFakeTimers();
  const timers = new Map<number, ReturnType<typeof setTimeout>>(); let sequence = 0;
  const runtime: NotificationRuntime = {
    now: Date.now,
    after(callback, ms) { const id = ++sequence; timers.set(id, setTimeout(callback, ms)); return id; },
    cancel(id) { clearTimeout(timers.get(id)); timers.delete(id); }, every: () => { throw new Error('Not used'); }, cancelEvery: () => {},
  };
  const request = vi.fn<Request>(async url => url.includes('/status') ? response({ status: 'wait' }) : response({ session_key: 'key /?', qrcode_image_data_url: 'data:image/png;base64,qr' }));
  const deps: WechatDependencies = { request, runtime, translate: key => key, loadConfig: vi.fn(async () => false),
    refreshRobotManager: vi.fn(), toast: vi.fn(), canWrite: () => true };
  const render = vi.fn(), service = createWechatService(createWechatClient(request), deps, render);
  return { service, deps, request, render };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('WeChat robot binding service', () => {
  it('posts bot_type, encodes session_key, preserves need_verifycode/scaned/confirmed flow and reloads config', async () => {
    const h = setup();
    h.request.mockResolvedValueOnce(response({ session_key: 'key /?', qrcode_open_url: 'https://wechat.test/qr', qrcode_image_data_url: 'data:qr' }))
      .mockResolvedValueOnce(response({ status: 'need_verifycode', message: 'phone digits' }));
    await h.service.start(' 3 '); await vi.advanceTimersByTimeAsync(0);
    expect(h.request.mock.calls[0]?.[1]?.body).toBe('{"bot_type":"3"}');
    expect(h.request.mock.calls[1]?.[0]).toBe('/api/robot/wechat/qrcode/status?session_key=key%20%2F%3F');
    expect(h.service.getModel()).toMatchObject({ mode: 'scanning', verify: true, phase: 'scan', status: 'phone digits', loading: false });
    h.request.mockResolvedValueOnce(response({ message: 'submitted' })).mockResolvedValueOnce(response({ status: 'scaned' }));
    await h.service.verify(' 012345 '); await vi.advanceTimersByTimeAsync(0);
    expect(h.request.mock.calls.find(([url]) => url.endsWith('/verify'))?.[1]?.body).toBe('{"session_key":"key /?","verify_code":"012345"}');
    expect(h.service.getModel()).toMatchObject({ phase: 'confirm', verify: false });
    h.request.mockResolvedValueOnce(response({ status: 'confirmed', ilink_bot_id: 'bot<&', message: 'bound' }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.deps.loadConfig).toHaveBeenCalledOnce(); expect(h.deps.toast).toHaveBeenCalledWith('bound');
    expect(h.service.getModel()).toMatchObject({ mode: 'bound', config: { enabled: true, bound: true, ilink_bot_id: 'bot<&' }, flashHidden: false });
    const calls = h.request.mock.calls.length; await vi.advanceTimersByTimeAsync(10_000); expect(h.request).toHaveBeenCalledTimes(calls); h.service.dispose();
  });
  it('accepts settings config callbacks during reload and retains the success flash while bound', async () => {
    const h = setup();
    vi.mocked(h.deps.loadConfig).mockImplementation(async () => { h.service.refreshBound({ bound: true, enabled: true, ilink_bot_id: 'saved', bot_token: 'token' }); return true; });
    h.request.mockResolvedValueOnce(response({ session_key: 'key' })).mockResolvedValueOnce(response({ status: 'confirmed', ilink_bot_id: 'saved' }));
    await h.service.start(''); await vi.advanceTimersByTimeAsync(0);
    expect(h.service.getModel()).toMatchObject({ mode: 'bound', flashHidden: false, flashVisible: true });
    await vi.advanceTimersByTimeAsync(4500); expect(h.service.getModel()).toMatchObject({ flashVisible: false, flashHidden: false });
    await vi.advanceTimersByTimeAsync(300); expect(h.service.getModel().flashHidden).toBe(true); h.service.dispose();
  });
  it('stops on expired/already-bound states and refreshes the robot manager for redirect binding', async () => {
    const h = setup();
    h.request.mockResolvedValueOnce(response({ session_key: 'expired' })).mockResolvedValueOnce(response({ status: 'expired' }));
    await h.service.start('3'); await vi.advanceTimersByTimeAsync(0);
    expect(h.service.getModel()).toMatchObject({ error: true, mode: 'scanning' });
    await vi.advanceTimersByTimeAsync(9000); expect(h.request).toHaveBeenCalledTimes(2);
    h.request.mockResolvedValueOnce(response({ session_key: 'redirect' })).mockResolvedValueOnce(response({ status: 'binded_redirect' }));
    await h.service.start('3'); await vi.advanceTimersByTimeAsync(0);
    expect(h.service.getModel().mode).toBe('bound'); expect(h.deps.refreshRobotManager).toHaveBeenCalled(); h.service.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('retries transient long-poll failures but never creates a second chain when verification overlaps', async () => {
    const h = setup();
    h.request.mockResolvedValueOnce(response({ session_key: 'key' })).mockRejectedValueOnce(new Error('network'));
    await h.service.start('3'); await vi.advanceTimersByTimeAsync(0); expect(h.service.getModel().status).toBe('network');
    let resolve!: (value: Response) => void;
    h.request.mockReturnValueOnce(new Promise(done => { resolve = done; })); await vi.advanceTimersByTimeAsync(1500);
    h.request.mockResolvedValueOnce(response({ message: 'verified' })); await h.service.verify('1234');
    expect(h.request.mock.calls.filter(([url]) => url.includes('/status'))).toHaveLength(2);
    resolve(response({ status: 'wait' })); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500); expect(h.request.mock.calls.filter(([url]) => url.includes('/status'))).toHaveLength(3); h.service.dispose();
  });
  it('handles demo missing session and generation failures without starting a polling loop', async () => {
    const h = setup(); h.request.mockResolvedValueOnce(response({ status: 'demo', message: 'demo only' }));
    await h.service.start('3'); await vi.advanceTimersByTimeAsync(5000); expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.service.getModel()).toMatchObject({ status: 'demo only', loading: false, mode: 'scanning' });
    h.request.mockResolvedValueOnce(response({ error: 'QR failed' }, 502)); await h.service.start('3');
    expect(h.service.getModel()).toMatchObject({ status: 'QR failed', error: true, loading: false, mode: 'idle' }); h.service.dispose();
  });
  it('discards old generation responses after rebinding, config refresh or disposal', async () => {
    const h = setup(); let resolve!: (value: Response) => void;
    h.request.mockReturnValueOnce(new Promise(done => { resolve = done; })); const first = h.service.start('old');
    await h.service.start('new'); await vi.advanceTimersByTimeAsync(0);
    resolve(response({ session_key: 'stale', message: 'stale' })); await first;
    expect(h.service.getModel().status).not.toBe('stale');
    h.request.mockReturnValueOnce(new Promise(done => { resolve = done; })); const poll = h.service.poll();
    h.service.refreshBound({ bot_token: 'secret', ilink_bot_id: 'configured' });
    resolve(response({ status: 'confirmed', ilink_bot_id: 'stale' })); await poll;
    expect(h.service.getModel()).toMatchObject({ mode: 'bound', config: { ilink_bot_id: 'configured' } });
    h.request.mockReturnValueOnce(new Promise(done => { resolve = done; })); const start = h.service.start('3');
    const renders = h.render.mock.calls.length; h.service.dispose(); resolve(response({ session_key: 'late' })); await start;
    expect(h.render).toHaveBeenCalledTimes(renders); expect(vi.getTimerCount()).toBe(0);
  });
  it('enforces the existing robot write guard for bind/verify', async () => {
    const h = setup(); h.deps.canWrite = () => false; await h.service.start('3'); await h.service.verify('123');
    expect(h.request).not.toHaveBeenCalled(); h.service.dispose();
  });
});
