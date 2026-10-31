import { describe, expect, it, vi } from 'vitest';
import { detachLiveStream } from '../live-stream';
import type { LiveChatStream } from '../types';
import { createConversationLiteCache } from './conversation-cache';
import { chatHashForConversation, chatHashWithoutConversation, createConversationNavigation } from './navigation';
import { liveTaskIsCurrent } from './primary-action';

function stream(over: Partial<LiveChatStream> = {}): LiveChatStream {
  return { active: true, conversationId: 'c1', progressId: 'p1', abortController: new AbortController(), detached: false, navigationSeq: 0, ...over };
}

describe('conversation lite cache', () => {
  it('keeps the most recently used entries and drops the oldest past the limit', () => {
    const cache = createConversationLiteCache<string>(2);
    cache.put('a', 'A');
    cache.put('b', 'B');
    expect(cache.get('a')).toBe('A');
    cache.put('c', 'C');
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe('A');
    expect(cache.size).toBe(2);
  });

  it('ignores empty keys and values, and invalidates one entry or all of them', () => {
    const cache = createConversationLiteCache<string>();
    cache.put('', 'x');
    cache.put('a', '');
    expect(cache.size).toBe(0);
    cache.put('a', 'A');
    cache.put('b', 'B');
    cache.invalidate('a');
    expect(cache.get('a')).toBeNull();
    cache.invalidate();
    expect(cache.size).toBe(0);
  });
});

describe('chat address', () => {
  it('names the conversation on the chat page only when the address does not already', () => {
    expect(chatHashForConversation('#chat', ' c 1 ')).toBe('#chat?conversation=c%201');
    expect(chatHashForConversation('#chat?conversation=c%201', 'c 1')).toBeNull();
    expect(chatHashForConversation('#projects', 'c1')).toBeNull();
    expect(chatHashForConversation('#chat', '')).toBeNull();
  });

  it('drops the conversation from the address, keeping the chat page', () => {
    expect(chatHashWithoutConversation('#chat?conversation=c1')).toBe('#chat');
    expect(chatHashWithoutConversation('#chat')).toBeNull();
    expect(chatHashWithoutConversation('#settings?x=1')).toBeNull();
  });
});

describe('conversation navigation', () => {
  function setup(visible = 'c1') {
    const detach = vi.fn();
    const cancelScheduled = vi.fn();
    const navigation = createConversationNavigation({
      visibleConversation: () => visible,
      cancelScheduledFromHash: cancelScheduled,
      detachLiveStream: detach,
    });
    return { navigation, detach, cancelScheduled, setVisible: (id: string) => { visible = id; } };
  }

  it('starts a new generation only when the visible conversation changes, or when forced', () => {
    const { navigation, setVisible } = setup('c1');
    expect(navigation.mark('c1')).toBe(0);
    expect(navigation.mark('c2')).toBe(1);
    setVisible('c2');
    expect(navigation.mark('c2', true)).toBe(2);
  });

  it('tracks the load in progress and aborts it when it is cancelled', () => {
    const { navigation } = setup();
    const controller = navigation.beginLoad(' c2 ');
    expect(navigation.isLoadPending('c2')).toBe(true);
    expect(navigation.pendingLoadId()).toBe('c2');
    expect(navigation.cancelPendingLoad()).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(navigation.cancelPendingLoad()).toBe(false);
  });

  it('forgets a finished load, but keeps a load that was started after it', () => {
    const { navigation } = setup();
    const first = navigation.beginLoad('c2');
    navigation.beginLoad('c3');
    navigation.releaseController(first);
    navigation.finishLoad('c2');
    expect(navigation.pendingLoadId()).toBe('c3');
    navigation.finishLoad('c3');
    expect(navigation.pendingLoadId()).toBe('');
  });

  it('counts load requests separately from navigation', () => {
    const { navigation } = setup();
    expect(navigation.nextLoadSeq()).toBe(1);
    expect(navigation.nextLoadSeq()).toBe(2);
    expect(navigation.loadSeq()).toBe(2);
    expect(navigation.seq()).toBe(0);
  });

  it('leaving the page moves to a new generation, cancels the load and detaches the stream', () => {
    const { navigation, detach, cancelScheduled } = setup('c1');
    const controller = navigation.beginLoad('c1');
    navigation.abandonForPageNavigation();
    expect(navigation.seq()).toBe(1);
    expect(cancelScheduled).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    expect(detach).toHaveBeenCalledWith('', true);
  });
});

describe('send button', () => {
  it('treats a stream with a conversation as current only for that conversation', () => {
    expect(liveTaskIsCurrent('c1', 'c1', false)).toBe(true);
    expect(liveTaskIsCurrent('c1', 'c2', true)).toBe(false);
  });

  it('treats a stream without a conversation (a new chat) as current while its progress is shown', () => {
    expect(liveTaskIsCurrent('', 'c1', true)).toBe(true);
    expect(liveTaskIsCurrent(null, '', false)).toBe(false);
  });
});

describe('detaching the live stream', () => {
  it('cuts the browser side of a stream of another conversation, and keeps the one that is shown', () => {
    const live = stream({ conversationId: 'c1' });
    expect(detachLiveStream(live, 'c1', false)).toBe(false);
    expect(live.active).toBe(true);
    expect(detachLiveStream(live, 'c2', false)).toBe(true);
    expect(live.detached).toBe(true);
    expect(live.active).toBe(false);
    expect(live.abortController.signal.aborted).toBe(true);
  });

  it('detaches a stream that has no conversation only when forced or when a conversation is opened', () => {
    expect(detachLiveStream(stream({ conversationId: null }), '', false)).toBe(false);
    expect(detachLiveStream(stream({ conversationId: null }), 'c1', false)).toBe(true);
    expect(detachLiveStream(stream({ conversationId: 'c1' }), 'c1', true)).toBe(true);
    expect(detachLiveStream(null, 'c1', true)).toBe(false);
  });
});
