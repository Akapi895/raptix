import { createMessageView, wrapTablesInBubble } from '@/features/chat/messages/view';
import { copyMessage, showCopySuccess, type CopyDependencies } from '@/features/chat/messages/copy';
import { normalizeReasoningContentForDisplay, mergeReasoningIntoProcessDetails } from '@/features/chat/messages/text';
import { applyProjectDisplayName, formatProjectNameForDisplay } from '@/features/chat/messages/project-name';
import { browser } from '@/platform/browser';
import { t, type ChatResources } from './runtime';

type ViewPorts = Parameters<typeof createMessageView>[0];
export interface MessageDependencies {
  locale(): string;
  markdown: ViewPorts['markdown'];
  attachMcpCalls: ViewPorts['attachMcpCalls'];
  cacheMcpExecutionIds(element: HTMLElement, ids: string[]): string[];
  applyScroll: ViewPorts['applyScroll'];
}
export function createChatMessages(doc: Document, resources: ChatResources, deps: MessageDependencies) {
  const projectName = () => {
    const el = doc.getElementById('chat-project-text');
    return (el?.dataset.fullName || el?.textContent || '').trim() || t('projects.noProject', 'No project');
  };
  const copy: Omit<CopyDependencies, 'doc' | 't'> = {
    clipboard: () => browser.clipboard,
    execCopy(text) {
      const area = doc.createElement('textarea');
      area.value = text; area.style.cssText = 'position:fixed;left:-999999px;top:-999999px;opacity:0';
      doc.body.appendChild(area); area.focus(); area.select();
      try { return doc.execCommand('copy'); } finally { area.remove(); }
    },
    alert: browser.alert, error: console.error,
    onCopied: button => showCopySuccess(button, t, resources.later),
  };
  const view = createMessageView({
    doc, t, ...deps, copy, setTimer: resources.later, projectName,
    noProjectName: () => t('projects.noProject', 'No project'),
    deferMcpCalls(element, ids) { element.dataset.pendingMcpExecutionIds = JSON.stringify(deps.cacheMcpExecutionIds(element, ids)); },
  });
  const target = (id: string | HTMLElement | null) => typeof id === 'string' ? doc.getElementById(id) : id;
  return {
    ...view,
    projectName, formatProjectNameForDisplay, applyProjectDisplayName,
    wrapTables: (element: HTMLElement) => wrapTablesInBubble(element, doc),
    setReasoning(id: string | HTMLElement | null, value: unknown) {
      const el = target(id); if (!el) return;
      const text = normalizeReasoningContentForDisplay(value);
      if (text) el.dataset.reasoningContent = text; else delete el.dataset.reasoningContent;
    },
    getReasoning(id: string | HTMLElement | null) { return normalizeReasoningContentForDisplay(target(id)?.dataset.reasoningContent || ''); },
    mergeReasoning: mergeReasoningIntoProcessDetails,
    copyMessage: (element: HTMLElement, button: HTMLElement | null) => copyMessage(element, button, { ...copy, doc, t }),
  };
}
export type ChatMessages = ReturnType<typeof createChatMessages>;
