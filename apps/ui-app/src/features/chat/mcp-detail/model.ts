// The detail of one tool execution, decided from its record: what each block shows, which result tab opens, and whether
// the execution can still be stopped. Pure; the modal only writes the view model into its elements.

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  blocked?: boolean;
}

export interface ExecutionRecord {
  id?: string;
  toolName?: string;
  status?: string;
  startTime?: string;
  arguments?: unknown;
  result?: ToolResult | null;
  error?: string;
  conversationId?: string;
}

export type ResultTab = 'success' | 'raw';

export interface BlockView {
  className: string;
  text: string;
}

export interface ResultTabs {
  successEnabled: boolean;
  active: ResultTab;
}

export interface ExecutionDetailView {
  toolName: string;
  executionId: string;
  status: string;
  statusText: string;
  statusClass: string;
  startTime: string | null;
  request: string;
  response: BlockView;
  success: BlockView;
  /** The label of the success tab: the blocked reason, or the correct-output label. */
  successLabelKey: 'mcpDetailModal.blockReason' | 'mcpDetailModal.correctInfo';
  error: string | null;
  tabs: ResultTabs;
  abort: { visible: boolean; executionId: string };
}

export interface DetailTexts {
  unknown: string;
  statusText(status: string): string;
  blockedStatusText: string;
  emptySuccess: string;
  running: string;
  noResponse: string;
}

/** The text of a result: its string content, or the text parts of its content list. */
export function resultText(result: ToolResult | null | undefined): string {
  if (!result) return '';
  const content = result.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(item => (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n\n');
  }
  if (content && typeof content === 'object' && typeof (content as { text?: unknown }).text === 'string') {
    return (content as { text: string }).text;
  }
  return '';
}

/** The result as JSON, for the raw tab. */
export function resultJson(result: ToolResult | null | undefined): string {
  if (!result) return '{}';
  const payload = {
    content: result.content,
    isError: !!result.isError,
    ...(result.blocked === true ? { blocked: true } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

export function requestJson(exec: ExecutionRecord): string {
  return JSON.stringify({ tool: exec.toolName, arguments: exec.arguments }, null, 2);
}

/** An execution that has not finished yet, and so can be stopped. */
export function isExecutionActive(status: string): boolean {
  return status === 'running' || status === 'background_running';
}

/** Which result tab opens, and whether the success tab can be used at all. */
export function tabsFor(defaultTab: ResultTab, hasSuccessContent: boolean): ResultTabs {
  return { successEnabled: hasSuccessContent, active: hasSuccessContent && defaultTab !== 'raw' ? 'success' : 'raw' };
}

/** The view of a detail. `status` is the execution's normalised status, as the monitor reports it. */
export function executionDetailView(exec: ExecutionRecord, status: string, texts: DetailTexts): ExecutionDetailView {
  const blocked = status === 'blocked';
  const active = isExecutionActive(status);
  const abort = active && !!exec.id ? { visible: true, executionId: exec.id || '' } : { visible: false, executionId: '' };
  const view: ExecutionDetailView = {
    toolName: exec.toolName || texts.unknown,
    executionId: exec.id || 'N/A',
    status,
    statusText: texts.statusText(status),
    statusClass: status === 'background_running' ? 'running' : status,
    startTime: exec.startTime || null,
    request: requestJson(exec),
    response: { className: 'code-block', text: '' },
    success: { className: 'code-block', text: '' },
    successLabelKey: blocked ? 'mcpDetailModal.blockReason' : 'mcpDetailModal.correctInfo',
    error: null,
    tabs: tabsFor('raw', false),
    abort,
  };

  if (exec.result) {
    const agentVisible = resultText(exec.result);
    if (blocked) {
      view.response = { className: 'code-block blocked', text: resultJson(exec.result) };
      view.success = { className: 'code-block blocked', text: agentVisible || exec.error || texts.blockedStatusText };
      view.tabs = tabsFor('success', true);
    } else if (exec.result.isError) {
      view.response = { className: 'code-block error', text: resultJson(exec.result) };
      view.success = { className: 'code-block', text: '' };
      view.tabs = tabsFor('raw', false);
      if (exec.error) view.error = exec.error;
    } else {
      view.response = { className: 'code-block', text: resultJson(exec.result) };
      view.success = { className: 'code-block', text: agentVisible || texts.emptySuccess };
      view.tabs = tabsFor('success', true);
    }
  } else {
    view.response = { className: 'code-block', text: active ? texts.running : texts.noResponse };
    view.tabs = tabsFor('raw', false);
  }
  return view;
}
