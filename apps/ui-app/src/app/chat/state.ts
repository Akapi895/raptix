import { createConversationLiteCache } from '@/features/chat/active/conversation-cache';
import { chatHashForConversation, chatHashWithoutConversation, createConversationNavigation } from '@/features/chat/active/navigation';
import { detachLiveStream, ownsLiveStream } from '@/features/chat/live-stream';
import { createTimelineStreamState } from '@/features/chat/timeline/stream-state';
import type { LiveChatStream } from '@/features/chat/types';
import type { LiveStreamPort } from '@/features/chat/composer/send';
import type { ScrollStream } from '@/features/chat/scroll-state';
import { browser } from '@/platform/browser';

export function createChatState(cancelScheduledFromHash: () => void, refreshPrimaryAction: () => void) {
  let conversationId = '';
  let live: LiveChatStream | null = null;
  let replayStream: ScrollStream | null | undefined = null;
  let replay: { progressId: string; assistantDomId: string; conversationId: string; timelineHostId: string } | null = null;
  let finalizationPolicy: object | undefined;
  let roleChanged = false;
  const navigation = createConversationNavigation({
    visibleConversation: () => conversationId,
    cancelScheduledFromHash,
    detachLiveStream: (id, force) => { if (detachLiveStream(live, id, force)) refreshPrimaryAction(); },
  });
  const livePort: LiveStreamPort = {
    get: () => live,
    set: stream => { live = stream; },
    clear(stream) {
      if (!ownsLiveStream(stream, live)) return false;
      stream.active = false; live = null; refreshPrimaryAction(); return true;
    },
    navigationSeq: navigation.seq,
  };
  return {
    conversationId: () => conversationId,
    setConversationId(id: string, announce = true) {
      conversationId = id;
      if (announce) browser.dispatch(new CustomEvent('conversation-changed', { detail: { conversationId: id } }));
    },
    syncHash(id: string) { const hash = chatHashForConversation(browser.location.hash, id); if (hash) browser.replaceUrl(hash); },
    clearHash() { const hash = chatHashWithoutConversation(browser.location.hash); if (hash) browser.replaceUrl(hash); },
    navigation,
    liteCache: createConversationLiteCache<unknown>(12),
    timeline: createTimelineStreamState(),
    live: livePort,
    replay: () => replay,
    setReplay(value: typeof replay) { replay = value; },
    replayStream: () => replayStream,
    setReplayStream(value: typeof replayStream) { replayStream = value; },
    setFinalizationPolicy(value: object) { finalizationPolicy = value; },
    takeFinalizationPolicy() { const value = finalizationPolicy; finalizationPolicy = undefined; return value; },
    markRoleChanged() { roleChanged = true; },
    takeRoleChanged() { const changed = roleChanged; roleChanged = false; return changed; },
    dispose() {
      navigation.cancelPendingLoad();
      live?.abortController.abort(); live = null;
      replay = null; replayStream = null;
      this.liteCache.invalidate();
      for (const map of Object.values(this.timeline)) map.clear();
    },
  };
}
export type ChatState = ReturnType<typeof createChatState>;
