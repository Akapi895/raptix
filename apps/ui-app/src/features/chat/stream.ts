import { streamEventSchema, type StreamEvent } from '../../api/types/chat';
import { BACKEND_INTERRUPT_CONTINUE_PREFIX } from '@/platform/backend-legacy-strings';
import type { LiveChatStream } from './types';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item.trim()))] : [];
}
export function parseChatEvent(value: unknown): StreamEvent { return streamEventSchema.parse(value); }
export function eventConversation(event: StreamEvent): string { return text(record(event.data).conversationId).trim(); }
export function ownsStream(stream: LiveChatStream, current: LiveChatStream | null, navigation: number): boolean {
  return current === stream && stream.active && !stream.detached && stream.navigationSeq === navigation;
}
export function mergeStreamingText(previous: string, delta: string, accumulated?: unknown): string {
  if (typeof accumulated === 'string') return accumulated;
  if (!delta || delta === previous) return previous;
  // Gateways sometimes send the complete prefix rather than an incremental delta.
  return delta.startsWith(previous) ? delta : previous + delta;
}
/** A response/done envelope alone is not evidence of a finalized answer. */
export function finalization(value: unknown): {
  finalized: boolean; finalizable: boolean; status: string; reason: string;
  pendingExecutionIds: string[]; missingChecks: string[]; evidenceRefs: string[];
} {
  const data = record(value);
  return { finalized: data.finalized === true, finalizable: data.finalizable === true,
    status: text(data.status), reason: text(data.completionReason),
    pendingExecutionIds: strings(data.pendingExecutionIds), missingChecks: strings(data.missingChecks), evidenceRefs: strings(data.evidenceRefs) };
}
export function finalizationNotice(value: unknown): string {
  const result = finalization(value);
  return ['Final answer is not verified.', result.reason || 'missing_finalization_contract',
    result.pendingExecutionIds.length ? `Pending tools: ${result.pendingExecutionIds.join(', ')}` : '',
    result.missingChecks.length ? `Missing checks: ${result.missingChecks.join(', ')}` : ''].filter(Boolean).join('\n');
}
export function isInterruptContinue(content: string): boolean {
  return content.trimStart().startsWith(BACKEND_INTERRUPT_CONTINUE_PREFIX);
}
