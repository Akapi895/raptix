// What an approval request says, read from the data the server sent with it: the tool, the question to answer, the primary
// thing the request touches (a URL, a command, a path), the arguments, and the timing of the wait. Pure: the wording comes
// in through `tr`.

export type HitlTranslate = (key: string, fallback: string, vars?: Record<string, unknown>) => string;

export interface HitlRecord {
  interruptId?: unknown;
  conversationId?: unknown;
  toolName?: unknown;
  toolCallId?: unknown;
  payload?: unknown;
  mode?: unknown;
  status?: unknown;
  reviewer?: unknown;
  decidedBy?: unknown;
  decided_by?: unknown;
  decision?: unknown;
  decisionMessage?: unknown;
  comment?: unknown;
  editedArgs?: unknown;
  editedArguments?: unknown;
  resolved?: unknown;
  timeoutSeconds?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
  [key: string]: unknown;
}

export interface ApprovalRequest {
  rawToolName: string;
  displayTool: string;
  question: string;
  primary: string;
  kind: 'browser' | 'command' | 'file' | 'generic';
  args: Record<string, unknown>;
  argsJSON: string;
}

export interface ApprovalTiming {
  timeoutSeconds: number;
  createdAt: number;
  expiresAt: number;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** The payload of a request: the tool call it wants to make, as the server holds it. */
export function hitlApprovalPayload(data: HitlRecord | null | undefined): Record<string, unknown> {
  const payload = data?.payload;
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

/** The arguments of the call, as an object, whether the server sent them as one or as text. */
export function hitlApprovalArguments(data: HitlRecord | null | undefined): Record<string, unknown> {
  const payload = hitlApprovalPayload(data);
  if (payload.argumentsObj && typeof payload.argumentsObj === 'object') return payload.argumentsObj as Record<string, unknown>;
  if (payload.arguments && typeof payload.arguments === 'object') return payload.arguments as Record<string, unknown>;
  if (typeof payload.arguments === 'string') {
    try {
      const parsed = JSON.parse(payload.arguments) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // The raw request is kept as it is below.
    }
  }
  return {};
}

/** The first text among the given keys, looked for in the arguments and then in the nested ones. */
export function findHitlArgumentValue(args: unknown, keys: string[]): string {
  if (!args || typeof args !== 'object') return '';
  const source = args as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  for (const nestedKey of ['input', 'params', 'options', 'request']) {
    const nested = source[nestedKey];
    if (nested && typeof nested === 'object') {
      const found = findHitlArgumentValue(nested, keys);
      if (found) return found;
    }
  }
  return '';
}

/** The question an approval asks, and what it is about: a browser visit, a command, a file change, or anything else. */
export function describeHitlApprovalRequest(data: HitlRecord, tr: HitlTranslate): ApprovalRequest {
  const payload = hitlApprovalPayload(data);
  const args = hitlApprovalArguments(data);
  const rawToolName = String(data.toolName || payload.toolName || 'tool').trim() || 'tool';
  const toolName = rawToolName.toLowerCase();
  const url = findHitlArgumentValue(args, ['url', 'uri', 'href', 'targetUrl', 'target_url']);
  const command = findHitlArgumentValue(args, ['command', 'cmd', 'script', 'shell_command']);
  const path = findHitlArgumentValue(args, ['path', 'filePath', 'file_path', 'filename']);
  const isBrowser = !!url || /browser|chrome|navigate|open_url|web/.test(toolName);
  const isCommand = !!command || /(^|::|_)exec$|shell|terminal|command|run_command/.test(toolName);
  const isFile = !!path || /write_file|edit_file|apply_patch|delete_file|move_file/.test(toolName);

  let question = template(tr, 'hitl.requestGeneric', 'Allow Raptix to call {{tool}}?', { tool: rawToolName });
  let primary = '';
  let kind: ApprovalRequest['kind'] = 'generic';
  if (isBrowser) {
    kind = 'browser';
    question = url
      ? (url.length > 160
        ? tr('hitl.requestVisitLongUrl', 'Allow Raptix to visit this address?')
        : template(tr, 'hitl.requestVisitUrl', 'Allow Raptix to visit {{url}}?', { url }))
      : tr('hitl.requestBrowser', 'Allow Raptix to use the browser?');
    primary = url;
  } else if (isCommand) {
    kind = 'command';
    question = tr('hitl.requestCommand', 'Allow Raptix to run this command?');
    primary = command;
  } else if (isFile) {
    kind = 'file';
    question = path
      ? (path.length > 160
        ? tr('hitl.requestModifyLongPath', 'Allow Raptix to modify this file?')
        : template(tr, 'hitl.requestFile', 'Allow Raptix to modify {{path}}?', { path }))
      : tr('hitl.requestFiles', 'Allow Raptix to modify files?');
    primary = path;
  }
  return {
    rawToolName,
    displayTool: rawToolName,
    question,
    primary,
    kind,
    args,
    argsJSON: JSON.stringify(args, null, 2),
  };
}

/** A translated text with its {{name}} places filled in. */
export function template(tr: HitlTranslate, key: string, fallback: string, vars: Record<string, unknown> = {}): string {
  let text = tr(key, fallback);
  Object.keys(vars).forEach(name => {
    text = text.replaceAll('{{' + name + '}}', String(vars[name]));
  });
  return text;
}

/** Whether an agent, not a person, is reviewing the request. */
export function isAgentReviewedHitl(data: HitlRecord | null | undefined): boolean {
  if (!data) return false;
  const reviewer = String(data.reviewer || data.decidedBy || data.decided_by || '').trim().toLowerCase();
  const status = String(data.status || '').trim().toLowerCase();
  return reviewer === 'audit_agent' || reviewer === 'agent' || reviewer === 'ai' || status === 'audit_running';
}

/** The timeout of a request and when it expires. A timeout with no expiry is counted from the creation time. */
export function getHitlApprovalTiming(data: HitlRecord | null | undefined): ApprovalTiming {
  const approval = record(hitlApprovalPayload(data).hitlApproval);
  const source = data ?? {};
  const timeoutSeconds = Number(source.timeoutSeconds != null ? source.timeoutSeconds : approval.timeoutSeconds);
  const createdAt = Date.parse(String(source.createdAt || approval.createdAt || ''));
  let expiresAt = Date.parse(String(source.expiresAt || approval.expiresAt || ''));
  const safeTimeout = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.floor(timeoutSeconds) : 0;
  if (!Number.isFinite(expiresAt) && safeTimeout > 0 && Number.isFinite(createdAt)) {
    expiresAt = createdAt + safeTimeout * 1000;
  }
  return {
    timeoutSeconds: safeTimeout,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
  };
}

/** The time left, as minutes and seconds. */
export function formatHitlRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

/** The share of the timeout still left, from 0 to 100. */
export function hitlRemainingPercent(timing: ApprovalTiming, now: number): number {
  const remaining = Math.max(0, timing.expiresAt - now);
  return Math.max(0, Math.min(100, (remaining / (timing.timeoutSeconds * 1000)) * 100));
}
