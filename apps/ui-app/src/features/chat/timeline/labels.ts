// The words and the bodies of the timeline steps that depend only on the event they show: the locale of the time, the
// Plan-Execute bodies (a JSON step list or a response, unwrapped), the title of a main stream step, and the finalization
// notice (whether the answer was checked, and what is still missing). Pure: the wording comes in through `t`.

import type { TimelineTranslate } from './tool-result';
import { BACKEND_NO_ASSISTANT_TEXT } from '@/platform/backend-legacy-strings';

/** The payload an event carries, with the fields the wording reads. */
export interface StepMeta {
  orchestration?: unknown;
  einoAgent?: unknown;
  status?: unknown;
  finalized?: unknown;
  finalizable?: unknown;
  completionReason?: unknown;
  evidenceVerified?: unknown;
  missingChecks?: unknown;
  pendingExecutionIds?: unknown;
  [key: string]: unknown;
}

/** The BCP 47 tag of the reader's language, as the time of a step is written. */
export function localeTag(uiLocale: string | null | undefined, fallbackLang: string | null | undefined): string {
  const pick = (lang: string): string => {
    if (lang.startsWith('ru')) return 'ru-RU';
    return 'en-US';
  };
  if (uiLocale) return pick(uiLocale);
  if (fallbackLang) return pick(fallbackLang);
  return 'en-US';
}

/** The options of the time of a step: a 24-hour clock for the Russian readers. */
export function timeFormatOptions(locale: string): Intl.DateTimeFormatOptions {
  const base: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
  if (locale === 'ru-RU') base.hour12 = false;
  return base;
}

/** The name of a Plan-Execute agent, as the progress bar words it. */
export function translatePlanExecuteAgentName(name: unknown, t: TimelineTranslate): string {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'planner') return t('progress.peAgentPlanner');
  if (n === 'executor') return t('progress.peAgentExecutor');
  if (n === 'replanner' || n === 'execute_replan' || n === 'plan_execute_replan') return t('progress.peAgentReplanning');
  return String(name || '').trim();
}

/** The user-facing text of a Plan-Execute JSON object: the first of its text keys that holds one. */
export function pickPeJsonUserText(o: unknown): string {
  if (!o || typeof o !== 'object') return '';
  const record = o as Record<string, unknown>;
  const keys = ['response', 'answer', 'message', 'content', 'summary', 'output', 'text', 'result'];
  for (const key of keys) {
    const v = record[key];
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) return s;
    }
  }
  return '';
}

/** Some models leave literal "\n" in the JSON text; once the text is read, they are turned into line breaks. */
export function normalizePeInlineEscapes(s: string): string {
  if (!s || s.indexOf('\\n') < 0) return s;
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

/**
 * The body of a Plan-Execute step: a planner's or replanner's step list becomes a numbered list, and a response is unwrapped
 * to plain text. A stream piece that is not valid JSON stays as it is.
 */
export function formatTimelineStreamBody(raw: string, meta: StepMeta | null | undefined): string {
  if (!raw || !meta || meta.orchestration !== 'plan_execute') return raw;
  const agent = String(meta.einoAgent || '').trim().toLowerCase();
  const text = String(raw).trim();
  if (text.length < 2 || text.charAt(0) !== '{') return raw;
  try {
    const o = JSON.parse(text) as Record<string, unknown> | null;
    if (agent === 'executor') {
      const u = pickPeJsonUserText(o);
      return u ? normalizePeInlineEscapes(u) : raw;
    }
    if (agent === 'planner' || agent === 'replanner' || agent === 'execute_replan' || agent === 'plan_execute_replan') {
      if (o && Array.isArray(o.steps) && o.steps.length) {
        return o.steps.map((s: unknown, i: number) => (i + 1) + '. ' + String(s)).join('\n');
      }
      const u = pickPeJsonUserText(o);
      if (u) return normalizePeInlineEscapes(u);
    }
  } catch {
    return raw;
  }
  return raw;
}

/** The title of a main stream step: the Plan-Execute phase it is in, or the answer stream of the other orchestrations. */
export function einoMainStreamPlanningTitle(responseData: StepMeta | null | undefined, prefix: string, t: TimelineTranslate): string {
  const orch = responseData?.orchestration;
  const agent = responseData && responseData.einoAgent != null ? String(responseData.einoAgent).trim() : '';
  if (orch === 'plan_execute' && agent) {
    const a = agent.toLowerCase();
    let key = 'chat.planExecuteStreamPhase';
    if (a === 'planner') key = 'chat.planExecuteStreamPlanner';
    else if (a === 'executor') key = 'chat.planExecuteStreamExecutor';
    else if (a === 'replanner' || a === 'execute_replan' || a === 'plan_execute_replan') key = 'chat.planExecuteStreamReplanning';
    return prefix + '📝 ' + t(key);
  }
  // A single agent or a deep or supervisor run streams the model's output, which is not a plan.
  if (orch != null && String(orch).trim() !== '' && orch !== 'plan_execute') {
    return prefix + '📝 ' + t('chat.assistantStreamPhase');
  }
  return prefix + '📝 ' + t('chat.planning');
}

/** Whether a text is the placeholder of an answer the model did not give. A final response must not replace a stream with it. */
export function isEinoEmptyResponsePlaceholder(text: unknown): boolean {
  if (text == null) return false;
  const s = String(text);
  return s.indexOf('no assistant text was captured') !== -1 || s.indexOf(BACKEND_NO_ASSISTANT_TEXT) !== -1;
}

/** The text a final response shows: the stream's buffer when the final text is only the placeholder. */
export function resolveFinalAssistantResponseText(finalMessage: unknown, streamState: { buffer?: unknown } | null | undefined): unknown {
  const buf = streamState && streamState.buffer != null ? String(streamState.buffer).trim() : '';
  if (isEinoEmptyResponsePlaceholder(finalMessage) && buf) return streamState?.buffer;
  return finalMessage;
}

export function isFinalizedResponseData(data: StepMeta | null | undefined): boolean {
  return !!(data && data.finalized === true);
}

/** Whether a response carries the finalization contract at all, whatever its value. */
export function hasFinalizationContract(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const keys = ['finalized', 'finalizable', 'completionReason', 'evidenceVerified', 'missingChecks'];
  return keys.some(key => Object.prototype.hasOwnProperty.call(data, key));
}

export function finalizationCheckTitle(data: StepMeta | null | undefined): string {
  return isFinalizedResponseData(data) ? 'Final response checks passed' : 'Final response checks failed';
}

const FINALIZATION_REASONS: Record<string, string> = {
  pending_tool_executions: 'Waiting for tool executions to finish',
  missing_execution_evidence: 'Completion evidence missing',
  awaiting_hitl: 'Waiting for human confirmation',
  empty_response: 'No valid response captured',
  missing_finalization_contract: 'Finalization proof missing',
  in_progress: 'Still verifying',
  blocked: 'Checks not passed',
  failed: 'Task failed',
  cancelled: 'Task cancelled',
  verified: 'Verified',
};

export function finalizationReasonLabel(reason: unknown, status?: unknown): string {
  const key = String(reason || status || '').trim();
  return Object.prototype.hasOwnProperty.call(FINALIZATION_REASONS, key) ? FINALIZATION_REASONS[key] ?? key : (key || 'Checks not passed');
}

/** A check the agent still has to pass, in the reader's words. */
export function finalizationMissingCheckLabel(check: unknown): string {
  const s = String(check || '').trim();
  if (!s) return '';
  if (s.indexOf('tool execution still queued or running') !== -1) return 'Tool executions are still queued or running';
  if (s.indexOf('execution evidence is required but no completed tool execution was recorded') !== -1) return 'This run requires execution evidence but no completed tool execution was recorded';
  if (s.indexOf('workflow is awaiting HITL approval') !== -1) return 'The workflow is awaiting HITL approval';
  if (s.indexOf('assistant final text is empty') !== -1) return 'The assistant final text is empty';
  if (s.indexOf('agent run status is ') === 0) return 'Agent run status is still ' + s.replace('agent run status is ', '');
  return s;
}

/** The first few values of a list, and the count of the rest. */
export function compactStringList(values: unknown, limit = 3): string[] {
  const arr = Array.isArray(values) ? values.filter(Boolean).map(String) : [];
  if (arr.length <= limit) return arr;
  return arr.slice(0, limit).concat(`and ${arr.length - limit} more`);
}

/** The notice of an answer that is not final yet: its state, what it waits for, and what is still missing. */
export function finalizationNoticeMarkdown(responseData: StepMeta | null | undefined, eventMessage: unknown): string {
  const hasContract = hasFinalizationContract(responseData);
  const reason = hasContract
    ? finalizationReasonLabel(responseData?.completionReason, responseData?.status)
    : finalizationReasonLabel('missing_finalization_contract');
  const lines = ['**Still verifying; no final conclusion yet**', '', 'Status: ' + reason];
  const pending = compactStringList(responseData?.pendingExecutionIds, 3);
  if (pending.length) lines.push('Pending tools: `' + pending.join('`, `') + '`');
  const rawMissingChecks = responseData?.missingChecks;
  const missingChecks: unknown[] = Array.isArray(rawMissingChecks) ? rawMissingChecks : (rawMissingChecks ? [rawMissingChecks] : []);
  const missing = compactStringList(missingChecks.map(finalizationMissingCheckLabel).filter(Boolean), 3);
  if (missing.length) lines.push('Pending checks: ' + missing.join('; '));
  if (!hasContract && eventMessage != null && String(eventMessage).trim() !== '') {
    lines.push('', 'The candidate output was moved into the process details so it is not mistaken for the final answer.');
  }
  return lines.join('\n');
}
