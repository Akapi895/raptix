// The live chat stream: the one request the page is reading right now. Ownership decides whether an event or a
// cleanup still belongs to that request, so a stream left behind by a navigation cannot change the visible chat.

import type { LiveChatStream } from './types';

/** Whether `stream` is the stream the page currently owns. */
export function ownsLiveStream(stream: LiveChatStream | null | undefined, active: LiveChatStream | null | undefined): boolean {
  return !!stream && active === stream;
}

/** Whether an event of `stream` must be dropped: the stream was replaced, ended, detached or navigated away from. */
export function shouldIgnoreLiveStreamEvent(
  stream: LiveChatStream | null | undefined,
  active: LiveChatStream | null | undefined,
  navigationSeq: number,
): boolean {
  return !stream || active !== stream || stream.active !== true || stream.detached === true || stream.navigationSeq !== navigationSeq;
}

/** The value the page keeps once no request is live. */
export function idleLiveStream(): { active: false; conversationId: null; progressId: null } {
  return { active: false, conversationId: null, progressId: null };
}

/**
 * Leaving a conversation whose request is still being read cuts only the browser's side of that response. The
 * backend task keeps running, and the task-event stream picks it up again when the conversation is reopened.
 * Returns true when a stream was detached.
 */
export function detachLiveStream(live: LiveChatStream | null | undefined, nextConversationId: string, force: boolean): boolean {
  if (!live || !live.active) return false;
  const liveId = String(live.conversationId || '').trim();
  const nextId = String(nextConversationId || '').trim();
  if (!force && liveId && liveId === nextId) return false;
  if (!force && !liveId && !nextId) return false;
  live.detached = true;
  live.active = false;
  const controller = live.abortController;
  if (controller && !controller.signal.aborted) controller.abort();
  return true;
}
