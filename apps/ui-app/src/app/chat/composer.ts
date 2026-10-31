import { createAttachmentsController } from '@/features/chat/composer/attachments';
import { createDraftController, fitTextareaHeight } from '@/features/chat/composer/draft';
import { createMentionController } from '@/features/chat/composer/mention';
import { bindComposerInput } from '@/features/chat/composer/input';
import { sendChatMessage, type SendDependencies } from '@/features/chat/composer/send';
import { storage } from '@/platform/storage';
import { browser } from '@/platform/browser';
import { resolveAgentEndpoint } from '@/platform/agent-endpoint';
import type { ChatState } from './state';
import type { ChatSession } from './session';
import { t, type ChatResources } from './runtime';

export interface ComposerDependencies extends Pick<SendDependencies,
  'toast' | 'role' | 'activeProjectId' | 'loadActiveTasks' | 'isTaskActive' | 'refreshPrimaryAction' |
  'addUserMessage' | 'addSystemMessage' | 'removeMessage' | 'notifyTaskStarted' | 'progress' | 'handleEvent' | 'attachReplay' | 'scroll' | 'request'> {
  upload(form: FormData, onProgress: (percent: number) => void): Promise<Response>;
  request(path: string, init?: RequestInit): Promise<Response>;
}
export function createChatComposer(doc: Document, state: ChatState, session: ChatSession, resources: ChatResources, deps: ComposerDependencies) {
  const input = () => doc.getElementById('chat-input') as HTMLTextAreaElement | null;
  const drafts = createDraftController({ storage, input, setTimer: resources.later, clearTimer: resources.clearTimer });
  const attachments = createAttachmentsController({ doc, t, alert: browser.alert, conversationId: state.conversationId, upload: deps.upload, input });
  const mention = createMentionController({
    doc, t, request: deps.request, currentRole: deps.role, takeRoleChanged: state.takeRoleChanged,
    input, saveDraftDebounced: drafts.saveDebounced,
  });
  const sendPorts: SendDependencies = {
    ...deps, input, attachments, drafts, t, alert: browser.alert,
    conversationId: () => state.conversationId() || null,
    navigationSeq: state.navigation.seq,
    activeProjectId: () => state.conversationId() ? '' : deps.activeProjectId(),
    aiChannelId: session.picker.selectedChannelId,
    hitlForm: session.hitl.readFromForm,
    reasoning: session.reasoning.requestField,
    takeFinalizationPolicy: state.takeFinalizationPolicy,
    streamEndpoint: signal => resolveAgentEndpoint(deps.request, signal),
    waitForHitlReady: session.hitl.waitForReady,
    invalidateLiteCache: state.liteCache.invalidate,
    live: state.live,
    canAttachReplay: () => true,
  };
  const sendMessage = (options?: { onRequestAccepted?: () => void }) => sendChatMessage(sendPorts, options);
  return {
    drafts, attachments, mention, input, fitTextareaHeight, sendMessage,
    start() {
      resources.own(bindComposerInput({ input, mention, fitHeight: fitTextareaHeight, saveDraftDebounced: drafts.saveDebounced, saveDraftNow: drafts.save, send: () => { void sendMessage(); } }));
      resources.on(browser.events, 'beforeunload', () => { const el = input(); if (el?.value) drafts.save(el.value); });
      const container = doc.querySelector<HTMLElement>('.chat-input-container');
      if (container && !container.id) container.id = 'chat-input-container';
      mention.setup(); attachments.bind();
      const tools = doc.getElementById('chat-tools-btn');
      if (tools) resources.on(tools, 'click', () => {
        const field = input(); if (!field) return;
        field.focus();
        if (mention.isOpen()) return;
        const caret = field.selectionStart;
        const prefix = caret > 0 && !/\s/.test(field.value[caret - 1] ?? '') ? ' @' : '@';
        field.setRangeText(prefix, caret, field.selectionEnd, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    dispose() { drafts.cancelPending(); attachments.dispose(); mention.dispose(); },
  };
}
export type ChatComposer = ReturnType<typeof createChatComposer>;
