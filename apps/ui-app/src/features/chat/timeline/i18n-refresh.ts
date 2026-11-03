import { translatePlanExecuteAgentName, type StepMeta } from './labels';
import { formatEinoUsageSummaryMessage, formatEinoUsageSummaryTitle } from './eino-format';
import { formatLiveTimelinePrunedMarker } from './prune';
import { getBackgroundRunningToolLabel, type TimelineTranslate } from './tool-result';

export interface TimelineI18nPorts {
  t: TimelineTranslate;
  timeLocale(): string;
  timeOptions(): Intl.DateTimeFormatOptions;
  translateProgress(message: string, data: unknown): string;
  einoPlanningTitle(meta: StepMeta): string;
  toolCallTitle(name: string, index: number, total: number): string;
  syncElapsed(progressId: string): void;
  applyToolCallStatus(item: HTMLElement, status: string): void;
  updateToolDetailToggleLabel(item: HTMLElement): void;
  setPlainText(element: HTMLElement, text: string): void;
  syncAssistantTurn(message: HTMLElement): void;
  syncMcpToggle(message: HTMLElement): void;
}

function parseRawData(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function agentPrefix(agent: string | undefined): string {
  return agent ? '[' + agent + '] ' : '';
}

/** The title of one timeline item, from its type and the data kept on it. Returns null when the item keeps its title. */
function itemTitle(item: HTMLElement, ports: TimelineI18nPorts, timeLocale: string): string | null {
  const { t } = ports;
  const data = item.dataset;
  const type = data.timelineType;
  const ap = agentPrefix(data.einoAgent);
  if (type === 'iteration' && data.iterationN) {
    const n = parseInt(data.iterationN, 10) || 1;
    const scope = data.einoScope;
    if (data.orchestration === 'plan_execute' && scope === 'main') {
      const phase = translatePlanExecuteAgentName(data.einoAgent || '', t);
      return t('chat.einoPlanExecuteRound', { n, phase });
    }
    if (scope === 'main') return t('chat.einoOrchestratorRound', { n });
    if (scope === 'sub') return t('chat.einoSubAgentStep', { n, agent: data.einoAgent || '' });
    return ap + t('chat.iterationRound', { n });
  }
  if (type === 'thinking') {
    if (data.responseStreamPlaceholder === '1') {
      return ports.einoPlanningTitle({ orchestration: data.orchestration || '', einoAgent: data.einoAgent || '' });
    }
    if (data.orchestration === 'plan_execute' && data.einoAgent) {
      return ports.einoPlanningTitle({ orchestration: 'plan_execute', einoAgent: data.einoAgent });
    }
    return ap + '🤔 ' + t('chat.aiThinking');
  }
  if (type === 'reasoning_chain') return ap + '🔗 ' + t('chat.reasoningChain');
  if (type === 'planning') {
    if (data.orchestration) return ports.einoPlanningTitle({ orchestration: data.orchestration, einoAgent: data.einoAgent || '' });
    return ap + '📝 ' + t('chat.planning');
  }
  if (type === 'tool_calls_detected' && data.toolCallsCount !== undefined) {
    const count = parseInt(data.toolCallsCount, 10) || 0;
    return ap + '🔧 ' + t('chat.toolCallsDetected', { count });
  }
  if (type === 'tool_call' && (data.toolName !== undefined || data.toolIndex !== undefined)) {
    const name = data.toolName ? data.toolName : t('chat.unknownTool');
    const index = parseInt(data.toolIndex ?? '', 10) || 0;
    const total = parseInt(data.toolTotal ?? '', 10) || 0;
    if (data.toolDisplayStatus) ports.applyToolCallStatus(item, data.toolDisplayStatus);
    return ap + '🔧 ' + ports.toolCallTitle(name, index, total);
  }
  if (type === 'tool_result' && (data.toolName !== undefined || data.toolSuccess !== undefined)) {
    const name = data.toolName ? data.toolName : t('chat.unknownTool');
    const displayStatus = data.toolDisplayStatus || '';
    const backgroundRunning = displayStatus === 'background_running';
    const success = data.toolSuccess === '1';
    const icon = displayStatus === 'blocked' ? '🛡 ' : backgroundRunning ? '⏳ ' : success ? '✅ ' : '❌ ';
    const label = displayStatus === 'blocked'
      ? t('chat.toolExecBlocked', { name })
      : backgroundRunning
        ? getBackgroundRunningToolLabel(t) + ': ' + name
        : success ? t('chat.toolExecComplete', { name }) : t('chat.toolExecFailed', { name });
    return ap + icon + label;
  }
  if (type === 'eino_agent_reply') return ap + '💬 ' + t('chat.einoAgentReplyTitle');
  if (type === 'eino_usage_summary') {
    const usage = {
      modelCalls: data.modelCalls,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      totalTokens: data.totalTokens,
      cachedTokens: data.cachedTokens,
      cacheWriteTokens: data.cacheWriteTokens,
      reasoningTokens: data.reasoningTokens,
    };
    const body = item.querySelector<HTMLElement>('.timeline-usage-summary');
    if (body) ports.setPlainText(body, formatEinoUsageSummaryMessage(t, usage, timeLocale));
    return formatEinoUsageSummaryTitle(t, usage, timeLocale);
  }
  if (type === 'cancelled') return '⛔ ' + t('chat.taskCancelled');
  if (type === 'user_interrupt_continue') return t('chat.userInterruptContinueTitle');
  if (type === 'progress' && data.progressMessage !== undefined) return ports.translateProgress(data.progressMessage, undefined);
  return null;
}

/**
 * Re-renders the text the page shows in the current language: the progress bars, the timeline titles and the times. Stream text is
 * not re-rendered; it keeps the language it arrived in.
 */
export function refreshTimelineI18n(doc: Document, ports: TimelineI18nPorts): void {
  const { t } = ports;
  const timeLocale = ports.timeLocale();
  const timeOpts = ports.timeOptions();

  // A running task's stop button reads "Stop task" in the current language, unless it is already cancelling.
  doc.querySelectorAll<HTMLElement>('.progress-message .progress-stop').forEach(btn => {
    if (!(btn as HTMLButtonElement).disabled && btn.id && btn.id.indexOf('-stop-btn') !== -1) {
      const cancelling = t('tasks.cancelling');
      if (btn.textContent !== cancelling) btn.textContent = t('tasks.stopTask');
    }
  });
  doc.querySelectorAll<HTMLElement>('.progress-toggle').forEach(btn => {
    const timeline = btn.closest('.progress-container, .message-bubble')?.querySelector('.progress-timeline');
    const expanded = !!timeline?.classList.contains('expanded');
    btn.textContent = expanded ? t('tasks.collapseDetail') : t('chat.expandDetail');
  });
  doc.querySelectorAll<HTMLElement>('.progress-message').forEach(msg => {
    const raw = msg.dataset.progressRawMessage;
    const stage = msg.querySelector<HTMLElement>('.progress-stage');
    if (stage && raw) {
      const data = parseRawData(msg.dataset.progressRawData);
      stage.textContent = ports.translateProgress(raw, data);
    }
    if (msg.id) ports.syncElapsed(msg.id);
  });

  doc.querySelectorAll<HTMLElement>('.timeline-item').forEach(item => {
    const titleSpan = item.querySelector<HTMLElement>('.timeline-item-title');
    if (!titleSpan) return;
    const title = itemTitle(item, ports, timeLocale);
    if (title !== null) titleSpan.textContent = title;
    const timeSpan = item.querySelector<HTMLElement>('.timeline-item-time');
    const createdAt = item.dataset.createdAtIso;
    if (timeSpan && createdAt) {
      const date = new Date(createdAt);
      if (!isNaN(date.getTime())) timeSpan.textContent = date.toLocaleTimeString(timeLocale, timeOpts);
    }
    if (item.classList.contains('tool-detail-collapsible')) ports.updateToolDetailToggleLabel(item);
  });

  doc.querySelectorAll<HTMLElement>('.timeline-live-pruned-marker').forEach(marker => {
    marker.textContent = formatLiveTimelinePrunedMarker(marker, t);
  });

  // The "expand / collapse" button of the process details.
  doc.querySelectorAll<HTMLElement>('.process-detail-btn span').forEach(span => {
    const assistantId = span.closest('.process-detail-btn')?.closest('.message.assistant')?.id;
    if (!assistantId) return;
    const timeline = doc.getElementById('process-details-' + assistantId)?.querySelector('.progress-timeline');
    const expanded = !!timeline?.classList.contains('expanded');
    span.textContent = expanded ? t('tasks.collapseDetail') : t('chat.expandDetail');
  });

  doc.querySelectorAll<HTMLElement>('#chat-messages .message.assistant').forEach(msg => {
    ports.syncAssistantTurn(msg);
    ports.syncMcpToggle(msg);
  });

  const copyLabel = t('common.copy');
  const copyTitle = t('chat.copyMessageTitle');
  doc.querySelectorAll<HTMLElement>('#chat-messages .message-copy-btn').forEach(btn => {
    if (btn.dataset.copySuccessActive === '1') return;
    const span = btn.querySelector('span');
    if (span) span.textContent = copyLabel;
    btn.title = copyTitle;
    btn.setAttribute('aria-label', copyTitle);
  });
}
