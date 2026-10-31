import { describe, expect, it, vi } from 'vitest';
import { createChatState } from './state';
import type { LiveChatStream } from '@/features/chat/types';

const liveStream = (conversationId: string): LiveChatStream => ({
  active: true, detached: false, conversationId, progressId: 'progress', navigationSeq: 0, abortController: new AbortController(),
});

describe('chat instance ownership', () => {
  it('keeps transcript streams, caches and pending approvals isolated across application instances', () => {
    const first = createChatState(vi.fn(), vi.fn());
    const second = createChatState(vi.fn(), vi.fn());
    const live = liveStream('first');
    first.live.set(live);
    first.liteCache.put('first', { title: 'First' });
    first.timeline.hitlInterruptToolItems.set('approval', 'item');
    expect(second.live.get()).toBeNull();
    expect(second.liteCache.get('first')).toBeNull();
    expect(second.timeline.hitlInterruptToolItems.size).toBe(0);
    first.dispose();
    expect(live.abortController.signal.aborted).toBe(true);
    expect(first.timeline.hitlInterruptToolItems.size).toBe(0);
    second.dispose();
  });

  it('does not let a replaced send clear its successor and aborts pending navigation on disposal', () => {
    const refresh = vi.fn();
    const state = createChatState(vi.fn(), refresh);
    const stale = liveStream('old');
    const current = liveStream('new');
    state.live.set(stale);
    state.live.set(current);
    expect(state.live.clear(stale)).toBe(false);
    expect(state.live.get()).toBe(current);
    expect(refresh).not.toHaveBeenCalled();
    const navigation = state.navigation.beginLoad('new');
    state.dispose();
    expect(navigation.signal.aborted).toBe(true);
    expect(current.abortController.signal.aborted).toBe(true);
    expect(state.live.get()).toBeNull();
  });
});
