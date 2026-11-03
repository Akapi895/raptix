import { translatePlanExecuteAgentName } from '../timeline/labels';
import type { TimelineTranslate } from '../timeline/tool-result';

// The server sends progress text in Chinese or English, depending on the version that emitted it. Both are mapped to the same keys.
const PROGRESS_KEYS: Record<string, string> = {
  // Chinese backend messages
  '\u6b63\u5728\u8c03\u7528AI\u6a21\u578b...': 'progress.callingAI',
  '\u6700\u540e\u4e00\u6b21\u8fed\u4ee3\uff1a\u6b63\u5728\u751f\u6210\u603b\u7ed3\u548c\u4e0b\u4e00\u6b65\u8ba1\u5212...': 'progress.lastIterSummary',
  '\u603b\u7ed3\u751f\u6210\u5b8c\u6210': 'progress.summaryDone',
  '\u6b63\u5728\u751f\u6210\u6700\u7ec8\u56de\u590d...': 'progress.generatingFinalReply',
  '\u8fbe\u5230\u6700\u5927\u8fed\u4ee3\u6b21\u6570\uff0c\u6b63\u5728\u751f\u6210\u603b\u7ed3...': 'progress.maxIterSummary',
  '\u6b63\u5728\u5206\u6790\u60a8\u7684\u8bf7\u6c42...': 'progress.analyzingRequestShort',
  '\u5f00\u59cb\u5206\u6790\u8bf7\u6c42\u5e76\u5236\u5b9a\u6d4b\u8bd5\u7b56\u7565': 'progress.analyzingRequestPlanning',
  '\u6b63\u5728\u542f\u52a8 Eino DeepAgent...': 'progress.startingEinoDeepAgent',
  '\u6b63\u5728\u542f\u52a8 Eino \u591a\u4ee3\u7406...': 'progress.startingEinoMultiAgent',
  // English (mirrors en-US.json so backend/cache text already stored in English still maps)
  'Calling AI model...': 'progress.callingAI',
  'Last iteration: generating summary and next steps...': 'progress.lastIterSummary',
  'Summary complete': 'progress.summaryDone',
  'Generating final reply...': 'progress.generatingFinalReply',
  'Max iterations reached, generating summary...': 'progress.maxIterSummary',
  'Analyzing your request...': 'progress.analyzingRequestShort',
  'Analyzing your request and planning test strategy...': 'progress.analyzingRequestPlanning',
  'Starting Eino DeepAgent...': 'progress.startingEinoDeepAgent',
  'Starting Eino multi-agent...': 'progress.startingEinoMultiAgent',
};

const EINO_AGENT_RE = /^\[Eino\]\s*(.+)$/;
const CALLING_TOOL_PREFIXES = ['\u6b63\u5728\u8c03\u7528\u5de5\u5177: ', 'Calling tool: '];

/**
 * Translates a progress line into the current language. A line that matches no known text is returned unchanged, so a message the
 * server wrote in a new form still shows.
 */
export function translateProgressMessage(
  message: string | null | undefined,
  data: { orchestration?: unknown } | null | undefined,
  t: TimelineTranslate | null | undefined,
): string | null | undefined {
  if (!message || typeof message !== 'string' || !t) return message;
  const trimmed = message.trim();
  const key = PROGRESS_KEYS[trimmed];
  if (key) return t(key);
  const eino = trimmed.match(EINO_AGENT_RE);
  if (eino) {
    let name = eino[1];
    if (data && data.orchestration === 'plan_execute') name = translatePlanExecuteAgentName(name, t);
    return t('progress.einoAgent', { name });
  }
  for (const prefix of CALLING_TOOL_PREFIXES) {
    if (trimmed.indexOf(prefix) === 0) return t('progress.callingTool', { name: trimmed.slice(prefix.length) });
  }
  return message;
}
