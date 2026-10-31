// The title of one process-detail row: what the timeline calls each kind of event. The wording is the page's own; the
// helpers that translate tool names and retry reasons are passed in, because the page provides them.

import type { Translate } from '../messages/text';

/**
 * Helpers the page may provide. Each returns undefined when it has nothing to say, and the wording of this module is
 * used instead, so a helper that is not loaded yet changes nothing.
 */
export interface TitleHelpers {
  t: Translate;
  escape(text: string): string;
  knowledgeToolName: string;
  einoRetryKind?(kind: unknown): string | undefined;
  einoRetryTitle?(data: Record<string, unknown>): string | undefined;
  einoRetryMessage?(message: string, data: Record<string, unknown>): string | undefined;
  translatePlanExecuteAgent?(agent: unknown): string | undefined;
  einoPlanningTitle?(data: Record<string, unknown>): string | undefined;
  toolCallTitle?(toolName: string, index: unknown, total: unknown): string | undefined;
  toolResultState?(data: Record<string, unknown>, extra?: { rawText: string }): { kind: string; isError: boolean } | undefined;
  backgroundRunningLabel?(): string | undefined;
  translateProgress?(message: string): string | undefined;
}

export interface TitleResult {
  title: string;
  /** The row's message when the title step rewrote it (an eino retry carries its own text). */
  message?: string;
}

const ICON_WORKFLOW_CONDITION = '✅';

/** The title of an event; `agentPrefix` is the "[agent] " prefix of the row, empty when none. */
export function processDetailTitle(eventType: string, rowMessage: string, data: Record<string, unknown>, agentPrefix: string, h: TitleHelpers): TitleResult {
  const t = h.t;
  const str = (value: unknown) => (value == null ? '' : String(value));
  const named = (value: unknown, base: string) => base + (value ? ' · ' + str(value) : '');
  switch (eventType) {
    case 'workflow_start':
      return { title: named(data.workflowName || data.workflowId, '🧭 Workflow started') };
    case 'workflow_done':
      return { title: named(data.workflowName || data.workflowId, '✅ Workflow completed') };
    case 'workflow_node_start':
      return { title: named(data.label || rowMessage || data.nodeId, '▶ Node started') };
    case 'workflow_node_result': {
      const label = str(data.label || data.nodeId);
      const status = str(data.status);
      const nodeType = data.nodeType != null ? str(data.nodeType).toLowerCase() : '';
      if (nodeType === 'condition') {
        const output = data.output as Record<string, unknown> | undefined;
        const matched = data.matched === true || data.matched === 'true' || (!!output && (output.matched === true || output.matched === 'true'));
        return { title: (matched ? ICON_WORKFLOW_CONDITION : '🔀') + ' Condition' + (label ? ' · ' + label : '') + ' → ' + (matched ? 'yes' : 'no') };
      }
      const icon = status === 'failed' ? '❌' : (status === 'skipped' ? '⏭️' : '✅');
      return { title: icon + ' Node completed' + (label ? ' · ' + label : '') + (status ? ` (${status})` : '') };
    }
    case 'workflow_branch_taken':
    case 'workflow_branch_skipped': {
      const taken = eventType === 'workflow_branch_taken';
      const branch = str(data.branchLabel);
      const target = str(data.targetLabel || data.targetId);
      return { title: (taken ? '➡️' : '⏭️') + (taken ? ' Branch taken' : ' Branch skipped') + (branch ? ' · ' + branch : '') + (target ? ' → ' + target : '') };
    }
    case 'workflow_tool_start':
      return { title: named(data.tool || data.toolName, '🔧 Tool node') };
    case 'workflow_agent_output':
      return { title: named(data.label || data.nodeId, '🤖 Agent output') };
    case 'workflow_hitl_checkpoint':
      return { title: '🧑‍⚖️ Human confirmation checkpoint' };
    case 'workflow_hitl_waiting':
      return { title: '🧑‍⚖️ Workflow awaiting approval' };
    case 'workflow_paused':
      return { title: '⏸️ Workflow paused' };
    case 'iteration': {
      const n = data.iteration || 1;
      if (data.orchestration === 'plan_execute' && data.einoScope === 'main') {
        const phase = h.translatePlanExecuteAgent?.(data.einoAgent) ?? str(data.einoAgent);
        return { title: t('chat.einoPlanExecuteRound', `Plan-Execute · round ${n} · ${phase}`, { n, phase }) };
      }
      if (data.einoScope === 'main') return { title: agentPrefix + t('chat.einoOrchestratorRound', `Orchestrator · round ${n}`, { n }) };
      if (data.einoScope === 'sub') {
        const agent = data.einoAgent != null ? str(data.einoAgent).trim() : '';
        return { title: agentPrefix + t('chat.einoSubAgentStep', `Sub-agent ${agent} · step ${n}`, { n, agent }) };
      }
      return { title: agentPrefix + t('chat.iterationRound', `Iteration ${n}`, { n }) };
    }
    case 'thinking':
      return { title: agentPrefix + '🤔 ' + t('chat.aiThinking', 'AI thinking') };
    case 'reasoning_chain':
      return { title: agentPrefix + '🔗 ' + t('chat.reasoningChain', 'Reasoning process') };
    case 'planning':
      return { title: h.einoPlanningTitle?.(data) ?? agentPrefix + '📝 ' + t('chat.planning', 'Planning') };
    case 'tool_calls_detected':
      return { title: agentPrefix + '🔧 ' + t('chat.toolCallsDetected', `Detected ${data.count || 0} tool call(s)`, { count: data.count || 0 }) };
    case 'tool_call': {
      const toolName = str(data.toolName || t('chat.unknownTool', 'Unknown tool'));
      const index = data.index || 0;
      const total = data.total || 0;
      const callTitle = h.toolCallTitle?.(toolName, index, total)
        ?? t('chat.callTool', 'Call tool: {{name}} ({{index}}/{{total}})' + h.escape(toolName) + ' (' + index + '/' + total + ')', { name: h.escape(toolName), index, total });
      return { title: agentPrefix + '🔧 ' + callTitle };
    }
    case 'tool_result':
      return { title: agentPrefix + toolResultTitle(data, h) };
    case 'eino_agent_reply':
      return { title: agentPrefix + '💬 ' + t('chat.einoAgentReplyTitle', 'Sub-agent reply') };
    case 'eino_empty_response_continue':
      return { title: t('chat.einoEmptyResponseContinueTitle', '🔁 Auto resume (no assistant text)') };
    case 'eino_run_retry': {
      const base = h.einoRetryTitle?.(data) ?? retryTitle(data, t);
      const message = h.einoRetryMessage?.(rowMessage, data) ?? retryMessage(rowMessage, data, h);
      return { title: base, message };
    }
    case 'knowledge_retrieval':
      return { title: '📚 ' + t('chat.knowledgeRetrieval', 'Knowledge retrieval') };
    case 'error':
      return { title: '❌ ' + t('chat.error', 'Error') };
    case 'cancelled':
      return { title: '⛔ ' + t('chat.taskCancelled', 'Task cancelled') };
    case 'hitl_interrupt': {
      const message = rowMessage.trim() ? rowMessage.trim() : t('hitl.pendingTitle', 'Pending approvals');
      return { title: agentPrefix + '🧑‍⚖️ HITL · ' + message };
    }
    case 'hitl_audit_agent_started':
      return { title: agentPrefix + 'Audit agent is reviewing' };
    case 'hitl_audit_agent':
      return { title: agentPrefix + 'Audit agent finished reviewing' };
    case 'hitl_resumed':
      return { title: agentPrefix + 'Approval granted' };
    case 'hitl_rejected':
      return { title: agentPrefix + 'Approval rejected' };
    case 'progress':
      return { title: h.translateProgress?.(rowMessage || '') ?? rowMessage };
    case 'user_interrupt_continue':
      return { title: t('chat.userInterruptContinueTitle', '⏸️ User interrupt & continue') };
    default:
      return { title: rowMessage };
  }
}

/** The result line of a tool call: its name and whether it succeeded, was blocked, or is still running. */
function toolResultTitle(data: Record<string, unknown>, h: TitleHelpers): string {
  const t = h.t;
  const toolName = str(data.toolName || t('chat.unknownTool', 'Unknown tool'));
  const noResult = t('timeline.noResult', 'No result');
  const raw = data.result ?? data.error ?? data.resultPreview ?? noResult;
  const resultText = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const state = h.toolResultState?.(data, { rawText: resultText }) ?? { kind: data.success !== false ? 'success' : 'error', isError: data.success === false };
  const background = state.kind === 'background_running';
  const success = !state.isError && !background;
  const icon = state.kind === 'blocked' ? '🛡' : (background ? '⏳' : (success ? '✅' : '❌'));
  const escaped = h.escape(toolName);
  let text: string;
  if (state.kind === 'blocked') text = t('chat.toolExecBlocked', `Tool ${escaped} blocked`, { name: escaped });
  else if (background) text = (h.backgroundRunningLabel?.() ?? 'Running in background') + ': ' + escaped;
  else if (success) text = t('chat.toolExecComplete', `Tool ${escaped} completed`, { name: escaped });
  else text = t('chat.toolExecFailed', `Tool ${escaped} failed`, { name: escaped });
  let line = icon + ' ' + text;
  if (toolName === h.knowledgeToolName && success) line = '📚 ' + line + ' - ' + t('chat.knowledgeRetrievalTag', 'Knowledge retrieval');
  return line;
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}

function retryTitle(data: Record<string, unknown>, t: Translate): string {
  const base = t('chat.einoRunRetryTitle', '🔁 Transient error retry');
  const attempt = Number(data.attempt || 0);
  const maxAttempts = Number(data.maxAttempts || 0);
  if (Number.isFinite(attempt) && attempt > 0 && Number.isFinite(maxAttempts) && maxAttempts > 0) {
    return base + ` (${attempt}/${maxAttempts})`;
  }
  return base;
}

const RETRY_KIND_LABELS: Record<string, string> = {
  rate_limit: 'Rate limited / too many requests',
  retryable_http: 'Retryable HTTP error',
  upstream_server: 'Upstream server error',
  http_error: 'HTTP error',
  upstream_busy: 'Upstream busy',
  network: 'Network connection error',
  stream: 'Stream read error',
  transient: 'Transient error',
};

export function retryKindLabel(kind: unknown, t: Translate): string {
  const key = str(kind).trim();
  if (!key) return '';
  const translated = t('chat.einoRunRetryKind_' + key, '');
  return translated || RETRY_KIND_LABELS[key] || key;
}

function retryMessage(message: string, data: Record<string, unknown>, h: TitleHelpers): string {
  const t = h.t;
  const base = message.trim();
  const errorRaw = data.errorSummary != null && str(data.errorSummary).trim() !== '' ? str(data.errorSummary).trim() : (data.error != null ? str(data.error).trim() : '');
  const lines: string[] = [];
  if (base) lines.push(base);
  const attempt = Number(data.attempt || 0);
  const maxAttempts = Number(data.maxAttempts || 0);
  const backoffSec = Number(data.backoffSec || 0);
  const kind = h.einoRetryKind?.(data.errorKind) ?? retryKindLabel(data.errorKind, t);
  if (Number.isFinite(attempt) && attempt > 0 && Number.isFinite(maxAttempts) && maxAttempts > 0) {
    const wait = Number.isFinite(backoffSec) && backoffSec > 0 ? backoffSec : '-';
    const plan = t('chat.einoRunRetryPlan', `Retry progress: attempt ${attempt}/${maxAttempts}, waiting ${wait}s`, { attempt, maxAttempts, backoffSec: wait });
    if (!base || base.indexOf(attempt + '/' + maxAttempts) === -1) lines.push(plan);
  }
  if (kind) lines.push(t('chat.einoRunRetryReasonKind', 'Reason type') + ': ' + kind);
  if (errorRaw && (!base || base.indexOf(errorRaw) === -1)) lines.push(t('chat.einoRunRetryErrorDetail', 'Error detail') + ': ' + errorRaw);
  return lines.join('\n');
}

/** The "[agent] " prefix of a row, from the agent name the event carries. */
export function agentPrefixOf(data: Record<string, unknown> | null | undefined): string {
  if (!data || data.einoAgent == null) return '';
  const name = String(data.einoAgent).trim();
  return name ? '[' + name + '] ' : '';
}
