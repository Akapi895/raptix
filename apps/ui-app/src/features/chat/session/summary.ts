// The one-line summaries of the session settings: the HITL mode under the card, and the model, effort and HITL
// shortcuts on the composer. Each is derived from the controls, so they are recomputed rather than stored.

import { modeLabelKey, normalizeHitlMode, normalizeHitlReviewer, type HitlMode } from '../hitl-model';
import { reasoningMenuLabel, type ReasoningControls, type Translate } from './reasoning';

const SHORTCUT_NAME_MAX = 10;

/** Shortens a channel or model name for the composer shortcut; counts code points, not UTF-16 units. */
export function truncateSummaryLabel(label: string, max = SHORTCUT_NAME_MAX): string {
  const chars = Array.from(String(label || ''));
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('') + '...';
}

export type AuditBackend = 'openai' | 'typesafe';

export function normalizeAuditBackend(raw: unknown): AuditBackend {
  const b = String(raw || '').trim().toLowerCase();
  return b === 'typesafe' || b === 'jev' || b === 'type-safe' ? 'typesafe' : 'openai';
}

/** The model the HITL audit agent uses: its own model when set, else the system model, else the backend default. */
export function auditModelLabel(backend: AuditBackend, modelName: string, systemModel: string): string {
  if (backend === 'typesafe') return modelName || 'jev-latest';
  return modelName || systemModel;
}

export function auditEngineLabel(backend: AuditBackend, modelName: string, systemModel: string, t: Translate): string {
  const engine = backend === 'typesafe'
    ? t('settings.hitl.auditBackendTypeSafe', 'TypeSafe Jev')
    : t('settings.hitl.auditBackendOpenAI', 'OpenAI-compatible model');
  const model = auditModelLabel(backend, modelName, systemModel);
  return engine + (model ? ' · ' + model : '');
}

export function hitlModeLabel(mode: HitlMode, t: Translate): string {
  const fallback: Record<HitlMode, string> = { off: 'Off', approval: 'Approval mode', review_edit: 'Review & edit' };
  const key = modeLabelKey(mode);
  return t(key, fallback[mode]);
}

export interface SummaryDependencies {
  doc: Document;
  t: Translate;
  channelLabel(): string;
  modelLabel(): string;
  systemModelLabel(): string;
  updateValues(): void;
  reasoning: ReasoningControls;
  /** The HITL controls as the form shows them. */
  readHitl(): { mode: unknown; reviewer: unknown };
  auditState(): { backend: unknown; modelName: string };
}

export interface ComposerSummary {
  updateReasoningSummary(): void;
  updateComposerShortcuts(): void;
}

export function createComposerSummary(deps: SummaryDependencies): ComposerSummary {
  const { doc, t } = deps;
  const byId = (id: string) => doc.getElementById(id);

  function hitlMode(): HitlMode {
    return normalizeHitlMode(deps.readHitl().mode);
  }

  function auditEngine(): string {
    const audit = deps.auditState();
    return auditEngineLabel(normalizeAuditBackend(audit.backend), audit.modelName, deps.systemModelLabel(), t);
  }

  function updateComposerShortcuts(): void {
    const modelEl = byId('chat-model-shortcut-text');
    const hitlEl = byId('chat-hitl-shortcut-text');
    if (modelEl) {
      const label = deps.modelLabel();
      modelEl.textContent = truncateSummaryLabel(label);
      modelEl.title = label;
      const shortcut = byId('chat-model-shortcut');
      if (shortcut) {
        const { mode, effort } = deps.reasoning.current();
        const text = t('chat.modelSettingsAria', 'Choose AI channel, model, and reasoning settings') + ': ' + deps.channelLabel() + ' · ' + label + ' · ' + reasoningMenuLabel(mode, effort, t);
        shortcut.setAttribute('aria-label', text);
        shortcut.title = text;
      }
      deps.updateValues();
    }
    if (hitlEl) {
      const cfg = deps.readHitl();
      const auditAgent = normalizeHitlReviewer(cfg.reviewer) === 'audit_agent';
      const prefix = auditAgent
        ? t('chat.sessionShortcutAuditAgent', 'Agent review')
        : t('chat.sessionShortcutHuman', 'Human approval');
      const approvalModel = auditAgent ? auditEngine() : '';
      const label = prefix + ': ' + hitlModeLabel(normalizeHitlMode(cfg.mode), t) + (approvalModel ? ' · ' + approvalModel : '');
      hitlEl.textContent = label;
      hitlEl.title = label;
    }
  }

  function updateReasoningSummary(): void {
    const el = byId('chat-reasoning-summary');
    if (!el || !byId('chat-reasoning-mode')) return;
    const hitlPart = hitlModeLabel(hitlMode(), t);
    el.textContent = hitlPart;
    el.title = hitlPart;
    updateComposerShortcuts();
  }

  return { updateReasoningSummary, updateComposerShortcuts };
}
