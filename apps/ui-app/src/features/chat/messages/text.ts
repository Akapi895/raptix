import { BACKEND_CALL_OPENAI_FAILED_PREFIX, BACKEND_EXECUTE_FAILED_PREFIX, BACKEND_INTERRUPT_CONTINUE_PREFIX } from '@/platform/backend-legacy-strings';

export type Translate = (key: string, fallback: string, values?: Record<string, unknown>) => string;

// The text of a message as the transcript shows it: the reasoning that is kept apart from the answer, the known
// server errors in the reader's language, the time it was written, and the welcome line of an empty chat.

/** Extended-thinking tail that the server appends to a reasoning text; it is never shown. */
export const CLAUDE_REASONING_UI_SUFFIX = '\n---CSAI_CLAUDE_THINKING_BLOCKS---\n';

/** The first line of a message the user sent to continue an interrupted run; only the process details show it. */
export const CHAT_INTERRUPT_CONTINUE_USER_PREFIX = BACKEND_INTERRUPT_CONTINUE_PREFIX;

export function isInterruptContinueInjectChatMessage(content: unknown): boolean {
  return typeof content === 'string' && content.trimStart().startsWith(CHAT_INTERRUPT_CONTINUE_USER_PREFIX);
}

export function normalizeReasoningContentForDisplay(text: unknown): string {
  if (text == null) return '';
  let s = String(text).trim();
  if (!s) return '';
  const index = s.lastIndexOf(CLAUDE_REASONING_UI_SUFFIX);
  if (index >= 0) s = s.slice(0, index).trim();
  return s;
}

interface ProcessDetailLike {
  eventType?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/** Whether the reasoning text is already among the process details (equal, or one contains the other). */
export function reasoningAlreadyInProcessDetails(processDetails: readonly (ProcessDetailLike | null | undefined)[], reasoning: string): boolean {
  if (!reasoning) return true;
  return processDetails.some(detail => {
    if (!detail) return false;
    const type = detail.eventType || '';
    if (type !== 'reasoning_chain' && type !== 'thinking') return false;
    const message = normalizeReasoningContentForDisplay(detail.message || '');
    return !!message && (message === reasoning || message.includes(reasoning) || reasoning.includes(message));
  });
}

/** The process details with the message's reasoning added, unless they already show it. */
export function mergeReasoningIntoProcessDetails<T extends object>(processDetails: readonly T[] | null | undefined, reasoningContent: unknown): (T | ProcessDetailLike)[] {
  const reasoning = normalizeReasoningContentForDisplay(reasoningContent);
  const details: (T | ProcessDetailLike)[] = Array.isArray(processDetails) ? processDetails.slice() : [];
  if (!reasoning || reasoningAlreadyInProcessDetails(details as ProcessDetailLike[], reasoning)) return details;
  details.push({ eventType: 'reasoning_chain', message: reasoning, data: { source: 'message.reasoningContent' } });
  return details;
}

/** The server's errors are written in Chinese; the transcript shows them in the reader's language. */
export function localizeAssistantError(content: string, t: (key: string) => string): string {
  let text = content;
  const executeFailedPrefix = BACKEND_EXECUTE_FAILED_PREFIX;
  if (text.indexOf(executeFailedPrefix) === 0) {
    text = t('chat.executeFailed') + ': ' + text.slice(executeFailedPrefix.length);
  }
  if (text.indexOf(BACKEND_CALL_OPENAI_FAILED_PREFIX) !== -1) {
    text = text.replace(new RegExp(BACKEND_CALL_OPENAI_FAILED_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), t('chat.callOpenAIFailed') + ':');
  }
  return text;
}

/** The moment a message carries: the given one when it parses, otherwise now. */
export function messageMoment(createdAt: string | number | Date | null | undefined, now: Date = new Date()): Date {
  if (!createdAt) return now;
  const parsed = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

/** The short time shown under a message: 24-hour for the Russian page. */
export function formatMessageTime(moment: Date, locale: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (locale === 'ru-RU') options.hour12 = false;
  return moment.toLocaleTimeString(locale, options);
}
