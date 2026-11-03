// The pure side of the tool calls on the timeline: how a status looks, how the calls and results of a process history pair up,
// and how a list of execution ids is cleaned. The screen work is in `tool-call-view.ts`.

import { getBackgroundRunningToolLabel, parseToolCallArgs, toolCallArgsEmpty, type TimelineTranslate } from './tool-result';

export interface ToolStatusPresentation {
  status: string;
  itemClass: string;
  badgeClass: string;
  label: string;
  icon: string;
}

/** How a tool status looks: the classes of its call and badge, its label, and its icon. Null for a status it does not know. */
export function toolCallStatusPresentation(status: unknown, t: TimelineTranslate): ToolStatusPresentation | null {
  const normalized = String(status || '').toLowerCase();
  const translate = (key: string, fallback: string) => {
    const value = t(key);
    return value && value !== key ? value : fallback;
  };
  if (normalized === 'running') {
    return { status: normalized, itemClass: 'tool-call-running', badgeClass: 'tool-status-running', label: translate('timeline.running', 'Running...'), icon: '' };
  }
  if (normalized === 'background_running') {
    return { status: normalized, itemClass: 'tool-call-running', badgeClass: 'tool-status-running', label: getBackgroundRunningToolLabel(t), icon: '' };
  }
  if (normalized === 'completed') {
    return { status: normalized, itemClass: 'tool-call-completed', badgeClass: 'tool-status-completed', label: translate('timeline.completed', 'Completed'), icon: '✅ ' };
  }
  if (normalized === 'failed') {
    return { status: normalized, itemClass: 'tool-call-failed', badgeClass: 'tool-status-failed', label: translate('timeline.execFailed', 'Execution failed'), icon: '❌ ' };
  }
  if (normalized === 'blocked') {
    return { status: normalized, itemClass: 'tool-call-blocked', badgeClass: 'tool-status-blocked', label: translate('timeline.blocked', 'Blocked'), icon: '🛡 ' };
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return { status: 'cancelled', itemClass: 'tool-call-failed', badgeClass: 'tool-status-failed', label: translate('tasks.statusCancelled', 'Cancelled'), icon: '⛔ ' };
  }
  if (normalized === 'result_missing') {
    return { status: normalized, itemClass: 'tool-call-incomplete', badgeClass: 'tool-status-incomplete', label: translate('timeline.resultMissing', 'Result record missing'), icon: '⚠️ ' };
  }
  return null;
}

/** A process detail as the history gives it: an event type, a message, and the data of the event. */
export interface ProcessDetailRecord {
  id?: unknown;
  eventType?: unknown;
  message?: unknown;
  createdAt?: unknown;
  data?: Record<string, unknown>;
}

interface PairedCall extends ProcessDetailRecord {
  data: Record<string, unknown>;
}

/**
 * Folds each tool result into the call it answers, so that one call shows its result. A result is matched by its call id,
 * then by the tool name, then by the first call still open; a newer agent-facing result replaces an older merged one.
 */
export function coalesceProcessDetailsToolPairs(details: ProcessDetailRecord[]): ProcessDetailRecord[] {
  if (!Array.isArray(details) || details.length === 0) return details;
  const callsById = new Map<string, PairedCall[]>();
  const fifoCalls: PairedCall[] = [];
  const out: ProcessDetailRecord[] = [];

  function absorbResult(target: PairedCall, resultDetail: ProcessDetailRecord): void {
    const rd = resultDetail.data || {};
    target.data = target.data || {};
    if (toolCallArgsEmpty(parseToolCallArgs(target.data))) {
      const resultArgs = parseToolCallArgs(rd);
      if (!toolCallArgsEmpty(resultArgs)) {
        target.data.argumentsObj = resultArgs;
        target.data.arguments = JSON.stringify(resultArgs);
      }
    }
    target.data._mergedResult = Object.assign({}, rd);
    if (resultDetail.id) target.data._mergedResultDetailId = resultDetail.id;
    if (resultDetail.createdAt) target.data._mergedResultAt = resultDetail.createdAt;
  }

  for (const detail of details) {
    const eventType = detail.eventType || '';
    const data = detail.data || {};
    const id = data.toolCallId != null ? String(data.toolCallId).trim() : '';

    if (eventType === 'tool_call') {
      const copy: PairedCall = {
        id: detail.id,
        eventType: detail.eventType,
        message: detail.message,
        createdAt: detail.createdAt,
        data: Object.assign({}, data),
      };
      if (id) {
        const list = callsById.get(id) ?? [];
        list.push(copy);
        callsById.set(id, list);
      }
      fifoCalls.push(copy);
      out.push(copy);
    } else if (eventType === 'tool_result') {
      let target: PairedCall | null = null;
      const list = id ? callsById.get(id) : undefined;
      if (list) {
        while (list.length) {
          const candidate = list.shift();
          if (candidate && candidate.data && !candidate.data._mergedResult) {
            target = candidate;
            break;
          }
        }
      }
      if (!target) {
        const resultName = String(data.toolName || '').trim().toLowerCase();
        let anyUnmatched: PairedCall | null = null;
        for (const c of fifoCalls) {
          if (!c || !c.data || c.data._mergedResult) continue;
          if (!anyUnmatched) anyUnmatched = c;
          const callName = String(c.data.toolName || '').trim().toLowerCase();
          if (!resultName || !callName || callName === resultName) {
            target = c;
            break;
          }
        }
        if (!target && id) target = anyUnmatched;
      }
      if (target) {
        // An agent-facing result, or a newer one, replaces an older merge (history may hold the full text from before a reduction).
        const prev = target.data._mergedResult as { agentFacing?: unknown } | undefined;
        if (prev && data.agentFacing !== true && prev.agentFacing === true) {
          out.push(detail);
          continue;
        }
        absorbResult(target, detail);
        continue;
      }
      out.push(detail);
    } else {
      out.push(detail);
    }
  }
  return out;
}

/** The execution ids of a list (or one id), trimmed, without blanks or repeats, in their order. */
export function normalizeExecutionIdList(value: unknown): string[] {
  const input: unknown[] = Array.isArray(value) ? value : (value == null ? [] : [value]);
  const seen = new Set<string>();
  const out: string[] = [];
  input.forEach(v => {
    const s = String(v == null ? '' : v).trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out;
}

/** The executions the server cancelled on its own, when a result says so. */
export function autoCancelledExecutionIdsFromData(data: Record<string, unknown> | null | undefined): string[] {
  const record = data || {};
  return normalizeExecutionIdList(record.autoCancelledPendingExecutionIds || record.autoCancelledExecutionIds || []);
}

/** The line that shows the condition of a workflow node and whether it matched. */
export function buildWorkflowConditionResultHtml(data: Record<string, unknown> | null | undefined, escape: (value: string) => string): string {
  const output = (data?.output as Record<string, unknown> | undefined) || {};
  const expr = data?.expression || output.condition || '';
  const matched = data?.matched === true || data?.matched === 'true' || output.matched === true || output.matched === 'true';
  const branchText = matched ? 'Yes (true)' : 'No (false)';
  const branchClass = matched ? 'is-true' : 'is-false';
  return `<div class="timeline-item-content workflow-condition-result">
        <div class="workflow-condition-row">
            <span class="workflow-agent-io-label">Expression</span>
            <code>${escape(String(expr || '(empty)'))}</code>
        </div>
        <div class="workflow-condition-row">
            <span class="workflow-agent-io-label">Result</span>
            <span class="workflow-condition-branch ${branchClass}">${escape(branchText)}</span>
        </div>
    </div>`;
}

/** The condition on the edge that led to a workflow node, or nothing when the edge has none. */
export function buildWorkflowBranchDetailHtml(data: Record<string, unknown> | null | undefined, escape: (value: string) => string): string {
  const cond = data?.edgeCondition ? String(data.edgeCondition) : '';
  if (!cond) return '';
  return `<div class="timeline-item-content workflow-branch-detail">
        <span class="workflow-agent-io-label">Edge condition</span>
        <code>${escape(cond)}</code>
    </div>`;
}
