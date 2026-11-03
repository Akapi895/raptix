import { createMcpDetailModal } from '@/features/chat/mcp-detail/modal';
import { getToolExecutionDisplayStatus } from '@/features/chat/timeline/tool-result';
import { openAppModal, closeAppModal, deferModalContent } from '@/ui/modal';
import { browser } from '@/platform/browser';
import { t, type ChatResources } from './runtime';

type ModalPorts = Parameters<typeof createMcpDetailModal>[0];
export interface McpDetailDependencies {
  request(path: string, init?: RequestInit): Promise<Response>;
  locale(): string;
  statusText(status: string): string;
  conversationOfExecution(id: string): string;
  openInterruptDialog: ModalPorts['openInterruptDialog'];
  requestCancelWithContinue: ModalPorts['requestCancelWithContinue'];
  refreshMonitor(): Promise<void>;
}
export function createChatMcpDetail(doc: Document, resources: ChatResources, deps: McpDetailDependencies) {
  return createMcpDetailModal({
    doc, t, apiFetch: deps.request, openModal: (id, options) => { openAppModal(id, options); }, closeModal: closeAppModal, deferContent: deferModalContent,
    alert: browser.alert, locale: deps.locale, statusText: deps.statusText, displayStatus: getToolExecutionDisplayStatus,
    async copyText(text) {
      try { await browser.clipboard.writeText(text); }
      catch {
        const area = doc.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;opacity:0'; doc.body.appendChild(area); area.focus(); area.select();
        try { if (!doc.execCommand('copy')) throw new Error('execCommand failed'); } finally { area.remove(); }
      }
    },
    setTimer: resources.later, conversationOfExecution: deps.conversationOfExecution, openInterruptDialog: deps.openInterruptDialog,
    requestCancelWithContinue: deps.requestCancelWithContinue, refreshMonitor: deps.refreshMonitor,
  });
}
