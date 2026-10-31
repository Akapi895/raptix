// The model picker of the composer: the popover that shows the AI channel, the model, the reasoning mode and the
// effort, and its sub-views. Choosing a model writes it into the channel of the system configuration.

import type { KeyValueStorage } from '../../../platform/storage';
import { REASONING_EFFORTS, REASONING_MODES, reasoningEffortLabel, reasoningMenuLabel, reasoningModeLabel, type ReasoningControls, type Translate } from './reasoning';
import {
  buildChannelDirectory, channelConfigState, isFreshModelCache, modelCacheKey, uniqueModelNames,
  type ChannelConfig, type ChannelDirectory,
} from './channels';

export const AI_CHANNEL_STORAGE_KEY = 'raptix-chat-ai-channel';
export type PickerView = 'main' | 'channel' | 'mode' | 'effort' | 'model';

const CHANNEL_LABEL_CLASS = 'chat-system-model-option-label chat-system-channel-option-label';
const MODEL_LABEL_CLASS = 'chat-system-model-option-label';
const EFFORT_LABEL_CLASS = 'chat-system-model-option-label chat-system-effort-option-label';

export interface ModelPickerDependencies {
  doc: Document;
  storage: KeyValueStorage;
  t: Translate;
  request(path: string, init?: RequestInit): Promise<Response>;
  allow(permission: string): boolean;
  reasoning: ReasoningControls;
  /** Re-reads the system configuration after a model is saved. */
  reloadConfig(): Promise<unknown>;
  updateSummary(): void;
  closeReasoningCard(): void;
  refreshSessionSettings(): void;
}

export interface ModelPicker {
  populateChannels(ai: unknown): void;
  selectedChannelId(): string;
  channelLabel(): string;
  modelLabel(): string;
  /** The model of the system's default channel, used by the HITL audit label when no audit model is set. */
  systemModelLabel(): string;
  persistChannelPref(): void;
  updateValues(): void;
  open(event?: Event): Promise<void>;
  close(force?: boolean): void;
  openView(view: PickerView, event?: Event): void;
}

interface Choice { value: string; label: string; dataset?: Record<string, string> }
interface ModelListCache { models: string[]; fetchedAt: number }

export function createModelPicker(deps: ModelPickerDependencies): ModelPicker {
  const { doc, storage, t } = deps;
  const byId = (id: string) => doc.getElementById(id);
  let directory: ChannelDirectory = buildChannelDirectory({});
  const cache = new Map<string, ModelListCache>();
  let requestSeq = 0;
  let saving = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let options: string[] = [];
  let currentModel = '';
  let loadError = '';

  function elements() {
    return {
      button: byId('chat-model-shortcut') as HTMLElement | null,
      menu: byId('chat-system-model-menu'),
      main: byId('chat-system-model-main'),
      subview: byId('chat-system-model-subview'),
      subviewTitle: byId('chat-system-model-subview-title'),
      list: byId('chat-system-model-list'),
      status: byId('chat-system-model-status'),
      subviewStatus: byId('chat-system-model-subview-status'),
    };
  }

  function setStatus(message: string, tone: string): void {
    const ui = elements();
    [ui.status, ui.subviewStatus].forEach(status => {
      if (!status) return;
      status.textContent = message || '';
      status.dataset.tone = tone || '';
    });
  }

  function inModelView(): boolean {
    const { subview } = elements();
    return !!subview && !subview.hidden && subview.dataset.view === 'model';
  }

  function setListDisabled(disabled: boolean): void {
    elements().list?.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = disabled; });
  }

  function clearCloseTimer(): void {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
  }

  function scheduleClose(ms: number): void {
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      saving = false;
      close(true);
    }, ms);
  }

  function selectedChannelId(): string {
    const select = byId('chat-ai-channel-select') as HTMLSelectElement | null;
    return directory.resolve(select ? select.value : '');
  }

  function resolvePickerChannelId(): string {
    return selectedChannelId() || directory.defaultId;
  }

  function channelLabel(): string {
    const id = resolvePickerChannelId();
    const channel = id ? directory.channels[id] : undefined;
    if (!channel) return t('chat.aiChannelDefaultShort', 'Default channel');
    return channel.name || id;
  }

  function modelLabel(): string {
    const id = resolvePickerChannelId();
    const channel = id ? directory.channels[id] : undefined;
    const model = channel && typeof channel.model === 'string' ? channel.model.trim() : '';
    return model || channelLabel();
  }

  function systemModelLabel(): string {
    const channel = directory.defaultId ? directory.channels[directory.defaultId] : undefined;
    const model = channel && typeof channel.model === 'string' ? channel.model.trim() : '';
    return model || (channel && (channel.name || directory.defaultId)) || modelLabel();
  }

  function updateValues(): void {
    const ui = { channel: byId('chat-system-model-channel-value'), model: byId('chat-system-model-current-value'), mode: byId('chat-system-model-mode-value'), effort: byId('chat-system-model-effort-value') };
    const { mode, effort } = deps.reasoning.current();
    const effortLabel = reasoningMenuLabel(mode, effort, t);
    if (ui.channel) ui.channel.textContent = channelLabel();
    if (ui.model) ui.model.textContent = modelLabel();
    if (ui.mode) ui.mode.textContent = reasoningModeLabel(mode, t);
    if (ui.effort) ui.effort.textContent = effortLabel;
    const composerEffort = byId('chat-model-shortcut-effort');
    if (composerEffort) composerEffort.textContent = effortLabel;
  }

  function persistChannelPref(): void {
    const id = selectedChannelId();
    if (id) storage.set(AI_CHANNEL_STORAGE_KEY, id);
    else storage.remove(AI_CHANNEL_STORAGE_KEY);
    deps.updateSummary();
    updateValues();
  }

  function populateChannels(ai: unknown): void {
    directory = buildChannelDirectory(ai);
    const select = byId('chat-ai-channel-select') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '';
    const fallback = doc.createElement('option');
    fallback.value = '';
    fallback.textContent = t('chat.aiChannelDefault', 'Use default channel');
    select.appendChild(fallback);
    Object.keys(directory.channels).sort().forEach(id => {
      const channel: ChannelConfig = directory.channels[id] ?? {};
      const option = doc.createElement('option');
      option.value = id;
      option.textContent = (channel.name || id) + (channel.model ? ' · ' + channel.model : '');
      select.appendChild(option);
    });
    select.value = directory.resolve(storage.get(AI_CHANNEL_STORAGE_KEY) || '');
    deps.refreshSessionSettings();
    deps.updateSummary();
  }

  /** Renders one list of choices; the chosen one is marked and carries the current badge. */
  function renderChoices(choices: Choice[], selected: string, labelClass: string, pick: (value: string) => void): void {
    const list = elements().list;
    if (!list) return;
    list.innerHTML = '';
    choices.forEach(choice => {
      const isSelected = choice.value === selected;
      const option = doc.createElement('button');
      option.type = 'button';
      option.className = 'chat-system-model-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) option.classList.add('is-selected');
      Object.assign(option.dataset, choice.dataset ?? {});
      const label = doc.createElement('span');
      label.className = labelClass;
      label.textContent = choice.label;
      option.appendChild(label);
      if (isSelected) {
        const current = doc.createElement('span');
        current.className = 'chat-system-model-current';
        current.textContent = t('chat.systemModelCurrent', 'Current');
        option.appendChild(current);
      }
      option.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        pick(choice.value);
      });
      list.appendChild(option);
    });
  }

  function renderModelOptions(models: readonly string[], current: string): number {
    const choices = uniqueModelNames(current, models).map(model => ({ value: model, label: model, dataset: { model } }));
    renderChoices(choices, current, MODEL_LABEL_CLASS, selectModel);
    return choices.length;
  }

  function renderEffortOptions(): void {
    const choices = REASONING_EFFORTS.map(effort => ({ value: effort, label: reasoningEffortLabel(effort, t) }));
    renderChoices(choices, deps.reasoning.current().effort, EFFORT_LABEL_CLASS, selectReasoningEffort);
  }

  function renderModeOptions(): void {
    const choices = REASONING_MODES.map(mode => ({ value: mode, label: reasoningModeLabel(mode, t) }));
    renderChoices(choices, deps.reasoning.current().mode, EFFORT_LABEL_CLASS, selectReasoningMode);
  }

  function renderChannelOptions(): void {
    const choices: Choice[] = [{ value: '', label: t('chat.aiChannelDefault', 'Use default channel') }]
      .concat(Object.keys(directory.channels).sort().map(id => ({ value: id, label: directory.channels[id]?.name || id })));
    renderChoices(choices, selectedChannelId(), CHANNEL_LABEL_CLASS, selectChannel);
  }

  function renderRetry(): void {
    const list = elements().list;
    if (!list) return;
    list.innerHTML = '';
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.className = 'chat-system-model-retry';
    retry.textContent = t('chat.systemModelRetry', 'Try again');
    retry.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void fetchModels(resolvePickerChannelId(), { force: true });
    });
    list.appendChild(retry);
  }

  function openView(view: PickerView, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const ui = elements();
    if (!ui.main || !ui.subview || !ui.list) return;
    if (view === 'main') {
      ui.main.hidden = false;
      ui.subview.hidden = true;
      updateValues();
      return;
    }
    ui.main.hidden = true;
    ui.subview.hidden = false;
    ui.subview.dataset.view = view;
    const setTitle = (key: string, fallback: string) => {
      if (ui.subviewTitle) ui.subviewTitle.textContent = t(key, fallback);
    };
    if (view === 'channel') {
      setTitle('chat.aiChannelLabel', 'AI channel');
      setStatus('', '');
      renderChannelOptions();
      return;
    }
    if (view === 'mode') {
      setTitle('chat.reasoningModeLabel', 'Model reasoning');
      setStatus('', '');
      renderModeOptions();
      return;
    }
    if (view === 'effort') {
      setTitle('chat.reasoningEffortLabel', 'Reasoning effort');
      setStatus('', '');
      renderEffortOptions();
      return;
    }
    setTitle('chat.systemModelField', 'Model');
    if (options.length) {
      const count = renderModelOptions(options, currentModel);
      setStatus(t('chat.systemModelLoaded', 'Loaded {count} models').replace('{count}', String(count)), 'success');
    } else if (loadError) {
      renderRetry();
      setStatus(loadError, 'error');
    } else {
      ui.list.innerHTML = '';
      setStatus(t('chat.systemModelLoading', 'Fetching model list…'), 'loading');
    }
  }

  async function fetchModels(channelId: string, opts: { force?: boolean } = {}): Promise<void> {
    const ui = elements();
    if (!ui.menu || !ui.list || ui.menu.hidden) return;
    const resolvedId = directory.resolve(channelId) || directory.defaultId;
    const channel: ChannelConfig = (resolvedId && directory.channels[resolvedId]) || {};
    const key = modelCacheKey(resolvedId, channel);
    const cached = cache.get(key);
    const requestId = ++requestSeq;
    currentModel = String(channel.model || '').trim();
    options = [];
    loadError = '';
    if (!opts.force && cached && isFreshModelCache(cached.fetchedAt, Date.now())) {
      options = cached.models.slice();
      if (inModelView()) renderModelOptions(options, currentModel);
      const count = uniqueModelNames(currentModel, options).length;
      setStatus(t('chat.systemModelLoaded', 'Loaded {count} models').replace('{count}', String(count)), 'success');
      return;
    }
    if (inModelView()) ui.list.innerHTML = '';
    setStatus(t('chat.systemModelLoading', 'Fetching model list…'), 'loading');
    try {
      if (!String(channel.api_key || '').trim()) {
        throw new Error(t('chat.systemModelNeedApiKey', 'Configure an API key in System Settings first'));
      }
      const response = await deps.request('/api/config/list-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: channel.provider || 'openai',
          base_url: String(channel.base_url || '').trim(),
          api_key: String(channel.api_key || '').trim(),
        }),
      });
      const result = await response.json().catch(() => ({})) as { success?: boolean; error?: string; models?: unknown };
      if (!response.ok || !result.success) throw new Error(result.error || t('chat.systemModelLoadFailed', 'Failed to fetch models'));
      if (requestId !== requestSeq || ui.menu.hidden) return;
      options = Array.isArray(result.models) ? result.models.map(String) : [];
      cache.set(key, { models: options.slice(), fetchedAt: Date.now() });
      if (inModelView()) renderModelOptions(options, currentModel);
      const count = uniqueModelNames(currentModel, options).length;
      setStatus(t('chat.systemModelLoaded', 'Loaded {count} models').replace('{count}', String(count)), 'success');
    } catch (error) {
      if (requestId !== requestSeq || ui.menu.hidden) return;
      loadError = error instanceof Error && error.message ? error.message : t('chat.systemModelLoadFailed', 'Failed to fetch models');
      if (inModelView()) renderRetry();
      setStatus(loadError, 'error');
    }
  }

  async function selectChannel(channelId: string): Promise<void> {
    const select = byId('chat-ai-channel-select') as HTMLSelectElement | null;
    if (!select) return;
    select.value = directory.resolve(channelId) || '';
    persistChannelPref();
    deps.refreshSessionSettings();
    updateValues();
    openView('main');
    setStatus(t('chat.systemModelLoading', 'Fetching model list…'), 'loading');
    await fetchModels(resolvePickerChannelId(), { force: true });
  }

  async function selectModel(model: string): Promise<void> {
    if (saving || !deps.allow('config:write')) return;
    const chosen = String(model || '').trim();
    if (!chosen) return;
    saving = true;
    setListDisabled(true);
    setStatus(t('chat.systemModelSaving', 'Saving…'), 'loading');
    try {
      const latestResponse = await deps.request('/api/config');
      if (!latestResponse.ok) throw new Error(await readError(latestResponse, t('chat.systemModelSaveFailed', 'Failed to save model')));
      const state = channelConfigState(await latestResponse.json(), resolvePickerChannelId());
      state.ai.channels[state.channelId] = { ...state.channel, model: chosen };
      const updateResponse = await deps.request('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: state.ai }),
      });
      if (!updateResponse.ok) throw new Error(await readError(updateResponse, t('chat.systemModelSaveFailed', 'Failed to save model')));
      const applyResponse = await deps.request('/api/config/apply', { method: 'POST' });
      if (!applyResponse.ok) throw new Error(await readError(applyResponse, t('chat.systemModelApplyFailed', 'Failed to apply model')));
      directory = buildChannelDirectory(state.ai);
      deps.updateSummary();
      await deps.reloadConfig();
      currentModel = chosen;
      options = [chosen].concat(options);
      updateValues();
      renderModelOptions(options, chosen);
      setStatus(t('chat.systemModelSaved', 'Saved automatically'), 'success');
      scheduleClose(650);
      return;
    } catch (error) {
      console.error('selectChatSystemModel', error);
      setStatus(error instanceof Error && error.message ? error.message : t('chat.systemModelSaveFailed', 'Failed to save model'), 'error');
    }
    saving = false;
    setListDisabled(false);
  }

  function finishReasoningUpdate(): void {
    deps.reasoning.persist();
    setStatus(t('chat.reasoningSessionUpdated', 'Session reasoning updated'), 'success');
    scheduleClose(450);
  }

  function selectReasoningMode(mode: string): void {
    if (saving || !byId('chat-reasoning-mode')) return;
    saving = true;
    deps.reasoning.setMode(mode);
    finishReasoningUpdate();
  }

  function selectReasoningEffort(effort: string): void {
    if (saving || !byId('chat-reasoning-effort')) return;
    saving = true;
    deps.reasoning.setEffort(effort);
    finishReasoningUpdate();
  }

  function close(force = false): void {
    if (saving && !force) return;
    clearCloseTimer();
    const ui = elements();
    if (ui.menu) ui.menu.hidden = true;
    if (ui.button) {
      ui.button.classList.remove('active');
      ui.button.setAttribute('aria-expanded', 'false');
    }
    if (ui.main) ui.main.hidden = false;
    if (ui.subview) ui.subview.hidden = true;
    requestSeq += 1;
  }

  async function open(event?: Event): Promise<void> {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const ui = elements();
    if (!ui.menu || !ui.button || !ui.list) return;
    if (!ui.menu.hidden) {
      close();
      return;
    }
    clearCloseTimer();
    deps.closeReasoningCard();
    ui.menu.hidden = false;
    ui.button.classList.add('active');
    ui.button.setAttribute('aria-expanded', 'true');
    if (ui.main) ui.main.hidden = false;
    if (ui.subview) ui.subview.hidden = true;
    ui.list.innerHTML = '';
    updateValues();
    await fetchModels(resolvePickerChannelId());
  }

  return {
    populateChannels,
    selectedChannelId,
    channelLabel,
    modelLabel,
    systemModelLabel,
    persistChannelPref,
    updateValues,
    open,
    close,
    openView,
  };
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string; message?: string };
    return body.error || body.message || fallback;
  } catch {
    return fallback;
  }
}
