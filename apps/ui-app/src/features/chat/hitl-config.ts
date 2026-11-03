import type { KeyValueStorage } from '../../platform/storage';
import {
  DEFAULT_HITL_TIMEOUT_SECONDS, defaultHitlConfig, HITL_MODE_OFF, mergeToolsForDisplay, modeLabelKey, normalizeHitlMode, normalizeHitlReviewer,
  normalizeHitlTimeout, parseStoredConfig, serialiseConfig, sessionToolsForUI, splitTools, storageKeyFor, stripGlobalTools,
  type HitlConfig, type HitlMode, type HitlReviewer, type HitlServerDefault,
} from './hitl-model';

export interface HitlConfigDependencies {
  doc: Document;
  storage: KeyValueStorage;
  t(key: string, fallback: string): string;
  toast(text: string, type: 'success' | 'error'): void;
  /** The visible conversation id, trimmed (empty for a new chat). */
  currentConversationId(): string;
  serverDefault(): HitlServerDefault | null | undefined;
  serverReviewer(): string | undefined;
  /** The config-level allowlist (config.yaml), when the page received it. */
  globalWhitelist(): string[] | null | undefined;
  setGlobalWhitelist(list: string[]): void;
  /** Server calls. Each is optional so the page works when a feature is not loaded. */
  api: {
    saveConversation?(conversationId: string, cfg: HitlConfig): Promise<unknown>;
    putDefault?(cfg: HitlConfig): Promise<unknown>;
    putDefaultReviewer?(reviewer: HitlReviewer): Promise<unknown>;
    mergeGlobalWhitelist?(tools: string[]): Promise<unknown>;
    refreshPageWhitelist?(): void;
  };
  /** Readiness of the server defaults, when the page is still loading them. */
  defaultReady(): Promise<unknown> | undefined;
  refreshSessionSettings(): void;
  updateReasoningSummary(): void;
  /** Schedules work the way the page always did; returns a handle the caller can cancel. */
  later(callback: () => void, ms: number): ReturnType<typeof setTimeout> | number;
}

export interface HitlConfigController {
  getForConversation(conversationId: string): HitlConfig;
  saveForConversation(conversationId: string, cfg: HitlConfig): void;
  readFromForm(): HitlConfig;
  setReviewerUI(reviewer: HitlReviewer): void;
  applyToUI(cfg: HitlConfig | null | undefined): void;
  updateStatusUI(): void;
  onReviewerChanged(reviewer: HitlReviewer): Promise<void>;
  bindReviewerToggles(): void;
  bindSidebarModeListener(): void;
  bindSensitiveToolsAutosave(): void;
  refreshByCurrentConversation(): void;
  waitForReady(conversationId: string): Promise<void>;
  beginConfigSync(conversationId: string, promise: Promise<unknown>): void;
  showApplyFeedback(text: string, isError: boolean, partial?: boolean): void;
  applySidebarConfig(): Promise<void>;
  scheduleAutosave(delayMs: number): void;
  dispose(): void;
}

/** The sidebar's HITL controls: mode, reviewer, timeout, the session allowlist and their autosave. */
export function createHitlConfigController(deps: HitlConfigDependencies): HitlConfigController {
  const { doc } = deps;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T | null;
  let applyFeedbackTimer: ReturnType<typeof setTimeout> | number | null = null;
  let autosaveTimer: ReturnType<typeof setTimeout> | number | null = null;
  let syncConversationId = '';
  let syncPromise: Promise<unknown> = Promise.resolve();
  let disposed = false;

  const fallback = (): HitlConfig => defaultHitlConfig(deps.serverDefault(), deps.serverReviewer());

  function getForConversation(conversationId: string): HitlConfig {
    const cid = String(conversationId ?? '').trim();
    const base = fallback();
    if (!cid) return base;
    return parseStoredConfig(deps.storage.get(storageKeyFor(cid)), base);
  }

  function saveForConversation(conversationId: string, cfg: HitlConfig): void {
    const cid = String(conversationId ?? '').trim();
    if (!cid) return;
    deps.storage.set(storageKeyFor(cid), JSON.stringify(serialiseConfig(cfg)));
  }

  function readFromForm(): HitlConfig {
    const mode = normalizeHitlMode(byId<HTMLSelectElement>('hitl-mode-select')?.value ?? HITL_MODE_OFF);
    const reviewer = normalizeHitlReviewer(byId<HTMLSelectElement>('hitl-reviewer-select')?.value ?? 'human');
    let sensitiveTools = (byId<HTMLTextAreaElement>('hitl-sensitive-tools')?.value ?? '').trim();
    const global = deps.globalWhitelist();
    if (Array.isArray(global) && global.length > 0) sensitiveTools = stripGlobalTools(global, sensitiveTools);
    return {
      mode,
      reviewer,
      sensitiveTools,
      timeoutSeconds: normalizeHitlTimeout(byId<HTMLSelectElement>('hitl-timeout-select')?.value ?? DEFAULT_HITL_TIMEOUT_SECONDS, DEFAULT_HITL_TIMEOUT_SECONDS),
      updatedAt: new Date().toISOString(),
    };
  }

  function setReviewerUI(reviewer: HitlReviewer): void {
    const value = normalizeHitlReviewer(reviewer);
    const hidden = byId<HTMLSelectElement>('hitl-reviewer-select');
    if (hidden) hidden.value = value;
    doc.querySelectorAll<HTMLElement>('.hitl-reviewer-toggle-btn').forEach(button => {
      const active = button.getAttribute('data-reviewer') === value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applyToUI(cfg: HitlConfig | null | undefined): void {
    const conf = cfg ?? fallback();
    const modeEl = byId<HTMLSelectElement>('hitl-mode-select');
    const toolsEl = byId<HTMLTextAreaElement>('hitl-sensitive-tools');
    const timeoutEl = byId<HTMLSelectElement>('hitl-timeout-select');
    if (modeEl) modeEl.value = normalizeHitlMode(conf.mode);
    setReviewerUI(conf.reviewer);
    // The editable field is scoped to the conversation. The config-level allowlist is applied by the server
    // and is not copied into it; an empty session shows the stable baseline.
    if (toolsEl) toolsEl.value = sessionToolsForUI(conf);
    if (timeoutEl) {
      const seconds = normalizeHitlTimeout(conf.timeoutSeconds, DEFAULT_HITL_TIMEOUT_SECONDS);
      // The server's timeout is shown as it is, even when the select does not list it.
      const supported = Array.from(timeoutEl.options ?? []).some(option => Number(option.value) === seconds);
      if (!supported) timeoutEl.add(new Option(String(seconds), String(seconds)));
      timeoutEl.value = String(seconds);
    }
    updateStatusUI();
    deps.refreshSessionSettings();
  }

  function updateStatusUI(): void {
    deps.updateReasoningSummary();
  }

  async function onReviewerChanged(reviewer: HitlReviewer): Promise<void> {
    setReviewerUI(reviewer);
    deps.updateReasoningSummary();
    const cfg = readFromForm();
    const cid = deps.currentConversationId();
    saveForConversation(cid, cfg);
    try {
      if (cid && deps.api.saveConversation) await deps.api.saveConversation(cid, cfg);
      else if (deps.api.putDefault) await deps.api.putDefault(cfg);
      else if (deps.api.putDefaultReviewer) await deps.api.putDefaultReviewer(cfg.reviewer);
      deps.toast(deps.t('hitl.pageReviewerSaved', 'Reviewer saved.'), 'success');
    } catch (error) {
      console.warn('onHitlReviewerChanged', error);
      deps.toast(deps.t('chat.hitlApplyFail', 'Failed to sync to server'), 'error');
    }
  }

  function bindReviewerToggles(): void {
    doc.querySelectorAll<HTMLElement>('.hitl-reviewer-toggle-btn').forEach(button => {
      if (button.dataset.hitlReviewerBound === '1') return;
      button.dataset.hitlReviewerBound = '1';
      button.addEventListener('click', () => {
        const value = button.getAttribute('data-reviewer');
        if (value) void onReviewerChanged(normalizeHitlReviewer(value));
      });
    });
  }

  function bindSidebarModeListener(): void {
    [byId('hitl-mode-select'), byId('hitl-timeout-select')].forEach(el => {
      if (!el || el.dataset.hitlModeBound === '1') return;
      el.dataset.hitlModeBound = '1';
      el.addEventListener('change', () => {
        applyToUI(readFromForm());
        deps.refreshSessionSettings();
        scheduleAutosave(0);
        deps.updateReasoningSummary();
      });
    });
  }

  function bindSensitiveToolsAutosave(): void {
    const toolsEl = byId('hitl-sensitive-tools');
    if (!toolsEl || toolsEl.dataset.hitlAutosaveBound === '1') return;
    toolsEl.dataset.hitlAutosaveBound = '1';
    toolsEl.addEventListener('input', () => scheduleAutosave(700));
    toolsEl.addEventListener('blur', () => scheduleAutosave(0));
  }

  function refreshByCurrentConversation(): void {
    applyToUI(getForConversation(deps.currentConversationId()));
  }

  async function waitForReady(conversationId: string): Promise<void> {
    const cid = String(conversationId ?? '').trim();
    if (cid && syncConversationId === cid) {
      await syncPromise;
      return;
    }
    const ready = deps.defaultReady();
    if (!cid && ready && typeof ready.then === 'function') {
      await ready.catch(() => undefined);
      if (!deps.currentConversationId()) refreshByCurrentConversation();
    }
  }

  function beginConfigSync(conversationId: string, promise: Promise<unknown>): void {
    syncConversationId = String(conversationId ?? '').trim();
    syncPromise = Promise.resolve(promise);
  }

  function showApplyFeedback(text: string, isError: boolean, partial = false): void {
    const el = byId('hitl-apply-feedback');
    if (applyFeedbackTimer) {
      clearTimeout(applyFeedbackTimer);
      applyFeedbackTimer = null;
    }
    if (!el) {
      if (text && isError) deps.toast(text, 'error');
      return;
    }
    el.classList.toggle('hitl-apply-feedback--error', isError);
    el.classList.toggle('hitl-apply-feedback--partial', partial && !isError);
    if (!text) {
      el.textContent = '';
      el.style.display = 'none';
      el.classList.remove('hitl-apply-feedback--error', 'hitl-apply-feedback--partial');
      return;
    }
    el.textContent = text;
    el.style.display = 'block';
    if (!isError) {
      applyFeedbackTimer = deps.later(() => {
        el.textContent = '';
        el.style.display = 'none';
        el.classList.remove('hitl-apply-feedback--error', 'hitl-apply-feedback--partial');
        applyFeedbackTimer = null;
      }, 3200);
    }
  }

  /** The sidebar apply: store locally, merge the global allowlist, then write to the server. */
  async function applySidebarConfig(): Promise<void> {
    const btn = byId<HTMLButtonElement>('hitl-apply-btn');
    showApplyFeedback('', false);
    if (btn) btn.disabled = true;
    try {
      const cfg = readFromForm();
      const cid = deps.currentConversationId();
      saveForConversation(cid, cfg);
      const tools = splitTools(cfg.sensitiveTools);
      let yamlMerged = false;
      if (!cid && tools.length > 0 && deps.api.mergeGlobalWhitelist) {
        const merged = await deps.api.mergeGlobalWhitelist(tools);
        if (Array.isArray(merged)) deps.setGlobalWhitelist(merged as string[]);
        yamlMerged = true;
      }
      applyToUI(cfg);
      if (cid && deps.api.saveConversation) {
        await deps.api.saveConversation(cid, cfg);
        showApplyFeedback(deps.t('chat.hitlApplyOkSync', 'HITL settings saved and synced to the server.'), false);
      } else if (deps.api.putDefault) {
        await deps.api.putDefault(cfg);
        showApplyFeedback(deps.t('chat.hitlApplyOkDefaultConfig', 'Default HITL settings saved to config.yaml and activated.'), false);
      } else if (yamlMerged) {
        showApplyFeedback(deps.t('chat.hitlApplyOkWhitelistYaml', 'Tool whitelist merged into config.yaml and active. Session settings are saved automatically.'), false);
      } else {
        showApplyFeedback(deps.t('chat.hitlApplyOkLocal', 'Saved in this browser.'), false);
      }
      deps.api.refreshPageWhitelist?.();
    } catch (error) {
      console.warn('applyHitlSidebarConfig', error);
      const detail = error instanceof Error && error.message ? error.message : String(error);
      showApplyFeedback(deps.t('chat.hitlApplyFail', 'Failed to sync to server') + (detail ? `: ${detail}` : ''), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function scheduleAutosave(delayMs: number): void {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    autosaveTimer = deps.later(() => {
      autosaveTimer = null;
      void applySidebarConfig();
    }, typeof delayMs === 'number' ? delayMs : 500);
  }

  return {
    getForConversation,
    saveForConversation,
    readFromForm,
    setReviewerUI,
    applyToUI,
    updateStatusUI,
    onReviewerChanged,
    bindReviewerToggles,
    bindSidebarModeListener,
    bindSensitiveToolsAutosave,
    refreshByCurrentConversation,
    waitForReady,
    beginConfigSync,
    showApplyFeedback,
    applySidebarConfig,
    scheduleAutosave,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (applyFeedbackTimer) clearTimeout(applyFeedbackTimer);
      if (autosaveTimer) clearTimeout(autosaveTimer);
    },
  };
}

export { modeLabelKey, mergeToolsForDisplay, type HitlMode, type HitlReviewer, type HitlConfig };
