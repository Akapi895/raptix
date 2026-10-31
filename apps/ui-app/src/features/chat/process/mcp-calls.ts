// The tool calls of an assistant turn, as the buttons list them: the execution ids and summaries, their status words,
// and the labels of the toggle that opens the list. Pure; the section that draws them is mcp-section.ts.

import type { Translate } from '../messages/text';

export interface ToolSummary {
  toolName: string;
  status: string;
  executionId: string;
  toolCallId: string;
  processDetailId: string;
  resultDetailId: string;
}

/** Trims and de-duplicates execution ids, keeping their first order. */
export function normalizeExecutionIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  values.forEach(value => {
    const id = value == null ? '' : String(value).trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  });
  return ids;
}

/** The execution ids a turn's process details refer to, including the ones inside a merged result. */
export function collectExecutionIdsFromProcessDetails(processDetails: unknown): string[] {
  if (!Array.isArray(processDetails)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  const add = (value: unknown) => {
    const id = value == null ? '' : String(value).trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  processDetails.forEach((detail: { data?: unknown } | null) => {
    const data = detail?.data && typeof detail.data === 'object' ? detail.data as Record<string, unknown> : null;
    if (!data) return;
    add(data.executionId);
    const merged = data._mergedResult && typeof data._mergedResult === 'object' ? data._mergedResult as Record<string, unknown> : null;
    if (merged) add(merged.executionId);
  });
  return ids;
}

/** A summary as a button needs it; every field is a string, so it can be stored as data. */
export function normalizeToolSummaryForButton(raw: unknown): ToolSummary {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    toolName: String(data.toolName || data.name || ''),
    status: String(data.status || ''),
    executionId: String(data.executionId || ''),
    toolCallId: String(data.toolCallId || ''),
    processDetailId: String(data.processDetailId || ''),
    resultDetailId: String(data.resultDetailId || ''),
  };
}

/** The summaries to draw: the given ones when there are any, otherwise a bare button per execution id. */
export function selectSummariesForButtons(summaries: unknown, executionIds: unknown): ToolSummary[] {
  const normalized = Array.isArray(summaries) ? summaries.map(normalizeToolSummaryForButton) : [];
  if (normalized.length > 0) return normalized;
  return normalizeExecutionIds(executionIds).map(executionId => normalizeToolSummaryForButton({ executionId }));
}

/** The status word of a tool execution, in the reader's language; empty for an unknown status. */
export function toolStatusLabel(status: unknown, t: Translate): string {
  const normalized = String(status || '').toLowerCase();
  const keys: Record<string, [string, string]> = {
    completed: ['mcpMonitor.statusSuccess', 'Success'],
    failed: ['mcpMonitor.statusFailed', 'Failed'],
    blocked: ['mcpMonitor.statusBlocked', 'Blocked'],
    running: ['mcpMonitor.statusRunning', 'Running'],
    cancelled: ['mcpMonitor.statusCancelled', 'Cancelled'],
    pending: ['mcpMonitor.statusPending', 'Pending'],
    result_missing: ['timeline.resultMissing', 'Result record missing'],
  };
  const entry = keys[normalized];
  return entry ? t(entry[0], entry[1]) : '';
}

/** The toggle's label: "N tool executions", or "collapse" while the list is open. */
export function formatToolsToggleLabel(count: number, expanded: boolean, t: Translate): string {
  if (expanded) return t('chat.collapseToolExecutions', 'Collapse tool runs');
  return t('chat.toolExecutionsCount', `${count} tool executions`, { n: count });
}

/** The tool name as the button shows it: the part after "server::" for an external tool. */
export function displayToolName(toolName: string): string {
  return toolName.includes('::') ? toolName.split('::')[1] ?? toolName : toolName;
}
