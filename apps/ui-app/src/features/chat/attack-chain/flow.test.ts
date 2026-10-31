import { describe, expect, it, vi } from 'vitest';
import { CHAIN_RETRY_DELAY_MS, createChainFlow, type ChainFlowDependencies } from './flow';

function makeDeps(response: () => Promise<Response>) {
  const calls: string[] = [];
  const timers: (() => void)[] = [];
  const request = vi.fn(response);
  const deps: ChainFlowDependencies = {
    t: (_key, fallback) => fallback,
    request,
    resetContext: () => calls.push('reset'),
    showLoading: () => calls.push('loading'),
    showError: message => calls.push(`error:${message}`),
    renderChain: () => calls.push('render'),
    updateStats: () => calls.push('stats'),
    setRegenerateEnabled: enabled => calls.push(`enabled:${enabled}`),
    showGenerating: () => calls.push('generating'),
    showRegenerating: () => calls.push('regenerating'),
    showConflict: () => calls.push('conflict'),
    refresh: () => calls.push('refresh'),
    setTimer: (callback, ms) => {
      expect(ms).toBe(CHAIN_RETRY_DELAY_MS);
      timers.push(callback);
      return timers.length;
    },
    logInfo: () => {},
    logError: () => {},
  };
  return { deps, calls, request, timers };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('attack chain regenerate', () => {
  it('posts to the regenerate endpoint and draws the new chain', async () => {
    const { deps, calls, request } = makeDeps(async () => json({ nodes: [], edges: [] }));
    const flow = createChainFlow(deps);
    flow.begin('c1');
    calls.length = 0;

    await flow.regenerate('c1');

    expect(request).toHaveBeenCalledWith('/api/attack-chain/c1/regenerate', { method: 'POST' });
    expect(calls).toEqual(['reset', 'regenerating', 'enabled:false', 'render', 'stats', 'enabled:true']);
    expect(flow.isLoading('c1')).toBe(false);
  });

  it('shows the conflict on 409 and looks again shortly while the chain is still being generated', async () => {
    const { deps, calls, timers } = makeDeps(async () => json({ error: 'busy' }, 409));
    const flow = createChainFlow(deps);
    flow.begin('c1');
    calls.length = 0;

    await flow.regenerate('c1');
    expect(calls).toEqual(['reset', 'regenerating', 'enabled:false', 'conflict', 'enabled:true']);

    timers[0]?.();
    expect(calls.at(-1)).toBe('refresh');
  });

  it('shows the failure of a regenerate that the server refused', async () => {
    const { deps, calls } = makeDeps(async () => json({ error: 'boom' }, 500));
    const flow = createChainFlow(deps);
    flow.begin('c1');
    calls.length = 0;

    await flow.regenerate('c1');

    expect(calls).toEqual(['reset', 'regenerating', 'enabled:false', 'reset', 'error:Regeneration failed: boom', 'enabled:true']);
    expect(flow.isLoading('c1')).toBe(false);
  });

  it('does not start a second regenerate while one is pending', async () => {
    const { deps, request } = makeDeps(() => new Promise<Response>(() => {}));
    const flow = createChainFlow(deps);
    flow.begin('c1');

    void flow.regenerate('c1');
    await flow.regenerate('c1');

    expect(request).toHaveBeenCalledTimes(1);
  });
});
