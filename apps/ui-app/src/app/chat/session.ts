import { createSessionLayout } from '@/features/chat/session/layout';
import { createSessionSelectSkin } from '@/features/chat/session/select-skin';
import { createSessionCard } from '@/features/chat/session/card';
import { createModelPicker } from '@/features/chat/session/model-picker';
import { createReasoningControls } from '@/features/chat/session/reasoning';
import { createComposerSummary } from '@/features/chat/session/summary';
import { createHitlConfigController } from '@/features/chat/hitl-config';
import type { HitlServerDefault } from '@/features/chat/hitl-model';
import { storage } from '@/platform/storage';
import { browser } from '@/platform/browser';
import { t, type ChatResources } from './runtime';
import type { ChatState } from './state';

type HitlPorts = Parameters<typeof createHitlConfigController>[0];
export interface SessionDependencies {
  request(path: string, init?: RequestInit): Promise<Response>;
  allow(permission: string): boolean;
  closeRolePanel(): void;
  closeProjectPanel(): void;
  hitl: {
    serverDefault(): HitlServerDefault | undefined;
    serverReviewer(): string | undefined;
    globalWhitelist(): string[] | null | undefined;
    setGlobalWhitelist(list: string[]): void;
    defaultReady(): Promise<unknown> | undefined;
    api: HitlPorts['api'];
    configLoaded(config: { auditBackend: string; auditModel: string; multiAgent: unknown }): void;
  };
}

export function createChatSession(doc: Document, state: ChatState, resources: ChatResources, deps: SessionDependencies, toast: HitlPorts['toast']) {
  let auditBackend = '';
  let auditModelName = '';
  const skin = createSessionSelectSkin(doc);
  const layout = createSessionLayout(doc, browser.events);
  const hitl = createHitlConfigController({
    doc, storage, t, toast,
    currentConversationId: state.conversationId,
    serverDefault: deps.hitl.serverDefault,
    serverReviewer: deps.hitl.serverReviewer,
    globalWhitelist: deps.hitl.globalWhitelist,
    setGlobalWhitelist: deps.hitl.setGlobalWhitelist,
    defaultReady: deps.hitl.defaultReady,
    api: deps.hitl.api,
    refreshSessionSettings: () => skin.refresh(),
    updateReasoningSummary: () => summary.updateReasoningSummary(),
    later: resources.later,
  });
  const card = createSessionCard({
    doc, mountPopover: layout.mountPopover, syncBarHeight: layout.syncBarHeight, syncLayerState: layout.syncLayerState,
    closeRolePanel: deps.closeRolePanel, closeProjectPanel: deps.closeProjectPanel,
    updateSummary: () => summary.updateReasoningSummary(), later: resources.later,
  });
  const reasoning = createReasoningControls({ doc, storage, refreshSessionSettings: skin.refresh, updateSummary: () => summary.updateReasoningSummary() });
  const picker = createModelPicker({
    doc, storage, t, request: deps.request, allow: deps.allow, reasoning, reloadConfig: () => loadConfig(),
    updateSummary: () => summary.updateReasoningSummary(), closeReasoningCard: card.closeReasoning, refreshSessionSettings: skin.refresh,
  });
  const summary = createComposerSummary({
    doc, t, channelLabel: picker.channelLabel, modelLabel: picker.modelLabel, systemModelLabel: picker.systemModelLabel,
    updateValues: picker.updateValues, reasoning, readHitl: hitl.readFromForm,
    auditState: () => ({ backend: auditBackend, modelName: auditModelName }),
  });
  async function loadConfig(): Promise<void> {
    if (resources.disposed) return;
    card.setReasoningRowVisible(true);
    reasoning.restoreFromStorage();
    try {
      const response = await deps.request('/api/config');
      if (!response.ok || resources.disposed) return;
      const config = await response.json() as { ai?: unknown; multi_agent?: { enabled?: boolean } | null; hitl?: { audit_backend?: unknown; audit_model?: { model?: unknown }; tool_whitelist?: string[] } };
      if (resources.disposed) return;
      picker.populateChannels(config.ai || {});
      auditBackend = typeof config.hitl?.audit_backend === 'string' ? config.hitl.audit_backend.trim().toLowerCase() : '';
      auditModelName = typeof config.hitl?.audit_model?.model === 'string' ? config.hitl.audit_model.model.trim() : '';
      if (Array.isArray(config.hitl?.tool_whitelist)) deps.hitl.setGlobalWhitelist(config.hitl.tool_whitelist.slice());
      deps.hitl.configLoaded({ auditBackend, auditModel: auditModelName, multiAgent: config.multi_agent || null });
      summary.updateReasoningSummary();
      reasoning.restoreFromStorage();
    } catch (error) { console.warn('Loading chat configuration failed', error); }
  }
  return {
    picker, reasoning, summary, card, hitl, skin, layout,
    loadConfig,
    start() {
      resources.own(layout.init());
      skin.init(doc.getElementById('conversation-reasoning-body'));
      hitl.bindSidebarModeListener(); hitl.bindReviewerToggles(); hitl.bindSensitiveToolsAutosave();
      resources.on(doc, 'keydown', event => {
        if ((event as KeyboardEvent).key !== 'Escape' || !doc.getElementById('chat-input-container')?.classList.contains('is-session-settings-open')) return;
        card.closeReasoning();
        doc.getElementById('chat-hitl-shortcut')?.focus({ preventScroll: true });
      });
      resources.on(doc, 'click', event => {
        const target = event.target as Node | null;
        if (!doc.getElementById('chat-reasoning-wrapper')?.contains(target) && !doc.getElementById('chat-hitl-shortcut')?.contains(target)) card.closeReasoning();
      });
      resources.on(doc, 'languagechange', () => { summary.updateReasoningSummary(); });
      void loadConfig();
    },
    dispose() { picker.close(true); card.closeReasoning(); hitl.dispose(); skin.dispose(); },
  };
}
export type ChatSession = ReturnType<typeof createChatSession>;
