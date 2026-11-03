// Session settings over the composer: reasoning, HITL and AI channel sections.
import { browser } from '@/platform/browser';

export interface SessionCardDependencies {
  doc: Document;
  mountPopover(): void;
  syncBarHeight(): void;
  syncLayerState(): void;
  closeRolePanel(): void;
  closeProjectPanel(): void;
  updateSummary(): void;
  later?(callback: () => void, ms: number): unknown;
}

export type SessionSection = 'hitl' | 'reasoning' | 'channel';

export interface SessionCard {
  setReasoningRowVisible(show: boolean): void;
  closeReasoning(): void;
  toggleReasoning(): void;
  open(section: SessionSection | string, event?: Event): void;
}

const FOCUS_DELAY_MS = 180;

export function createSessionCard(deps: SessionCardDependencies): SessionCard {
  const { doc } = deps;
  const byId = (id: string) => doc.getElementById(id);

  function closeReasoning(): void {
    const wrap = byId('chat-reasoning-wrapper');
    const toggle = byId('conversation-reasoning-toggle');
    if (wrap) wrap.classList.add('conversation-reasoning-collapsed');
    deps.syncLayerState();
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function toggleReasoning(): void {
    const wrap = byId('chat-reasoning-wrapper');
    const toggle = byId('conversation-reasoning-toggle');
    if (!wrap || !toggle) return;
    deps.syncBarHeight();
    wrap.classList.toggle('conversation-reasoning-collapsed');
    deps.syncLayerState();
    const collapsed = wrap.classList.contains('conversation-reasoning-collapsed');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (!collapsed) {
      deps.closeRolePanel();
      deps.updateSummary();
    }
  }

  function setReasoningRowVisible(show: boolean): void {
    deps.mountPopover();
    const wrap = byId('chat-reasoning-wrapper');
    if (!wrap) return;
    wrap.style.display = show ? '' : 'none';
    if (!show) {
      closeReasoning();
      return;
    }
    deps.syncBarHeight();
    deps.updateSummary();
  }

  function open(section: string, event?: Event): void {
    event?.stopPropagation();
    deps.mountPopover();
    const wrap = byId('chat-reasoning-wrapper');
    const toggle = byId('conversation-reasoning-toggle');
    if (!wrap || !toggle || wrap.style.display === 'none') return;
    deps.syncBarHeight();
    wrap.classList.remove('conversation-reasoning-collapsed');
    deps.syncLayerState();
    toggle.setAttribute('aria-expanded', 'true');
    deps.closeRolePanel();
    deps.closeProjectPanel();
    deps.updateSummary();

    const target = sectionTarget(section);
    const group = target?.closest<HTMLElement>('.session-settings-group');
    if (group && typeof group.scrollIntoView === 'function') {
      group.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    const customTrigger = target?.closest('.session-settings-select')?.querySelector<HTMLElement>('.session-settings-select-trigger') ?? null;
    (deps.later ?? browser.setTimeout)(() => {
      if (customTrigger) customTrigger.focus({ preventScroll: true });
      else target?.focus({ preventScroll: true });
    }, FOCUS_DELAY_MS);
  }

  function sectionTarget(section: string): HTMLElement | null {
    if (section === 'hitl') return byId('hitl-mode-select');
    if (section === 'reasoning') return byId('chat-reasoning-mode');
    return byId('chat-ai-channel-select');
  }

  return { setReasoningRowVisible, closeReasoning, toggleReasoning, open };
}
