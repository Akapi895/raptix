// Titles of the conversation list: cut at a character boundary and, when possible, at a punctuation mark, so that a
// Chinese title is never split in the middle of a word.

const BREAK_CHARS = new Set(['\uff0c', '\u3002', '\u3001', ' ', ',', '.', ';', ':', '!', '?', '\uff01', '\uff1f', '/', '\\', '-', '_']);

/** Shortens a title to `maxLength` characters, preferring a break within the last fifth of the cut. */
export function truncateTitle(text: string, maxLength = 50): string {
  if (!text || typeof text !== 'string') return text || '';
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  let kept = chars.slice(0, maxLength);
  const searchRange = Math.floor(maxLength * 0.2);
  let breakAt = kept.length;
  for (let i = kept.length - 1; i >= kept.length - searchRange && i >= 0; i--) {
    if (BREAK_CHARS.has(kept[i] as string)) {
      breakAt = i + 1;
      break;
    }
  }
  if (breakAt < kept.length) kept = kept.slice(0, breakAt);
  return kept.join('') + '...';
}

/** The title a row shows: the stored title, or the placeholder for a conversation that has none yet. */
export function conversationTitle(conversation: { title?: unknown }): string {
  return (conversation.title as string) || 'Untitled conversation';
}
