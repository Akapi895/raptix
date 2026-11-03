import { translateRuntime } from '../../i18n';
import { http } from '../../platform/http';
import { createActions, type Actions } from '../../ui/actions';
import { createToolGuardService, type ToolGuardService } from './service';
import { createToolGuardView, type ToolGuardView } from './view';

export { createToolGuardService, GuardError } from './service';
export { normalizeConfig, parseServerRuleError, validateRules, MAX_RULES } from './model';
export type { GuardConfig, GuardRule, GuardTestResult } from './model';
export { createToolGuardView } from './view';

export interface ToolGuardFeatureDependencies {
  doc: Document;
  actions?: Actions;
  canRead(): boolean;
  canWrite(): boolean;
  /** Surfaces a load/save message to the page-level feedback line when needed. */
  translate?: (key: string, params?: Record<string, string | number>) => string;
}

export interface ToolGuardFeature {
  service: ToolGuardService;
  view: ToolGuardView;
  /** Binds the controls and loads the current configuration. */
  start(): Promise<void>;
  /** Called by the router each time the tool-guard page opens. */
  load(): Promise<void>;
  dispose(): void;
}

/** Composition root: the transport is the platform client, copy comes from the i18n resources. */
export function initToolGuard(dependencies: ToolGuardFeatureDependencies): ToolGuardFeature {
  const translate = dependencies.translate ?? ((key: string, params?: Record<string, string | number>) => {
    const value = translateRuntime(`toolGuard.${key}`, params as never);
    return String(value);
  });
  const service = createToolGuardService({
    transport: { raw: (path, init) => http.raw(path, init) },
    t: translate,
  });
  const actions = dependencies.actions ?? createActions();
  const view = createToolGuardView({
    doc: dependencies.doc,
    service,
    actions,
    t: translate,
    canRead: dependencies.canRead,
    canWrite: dependencies.canWrite,
  });
  let unbind: (() => void) | undefined;
  let unbindActions: (() => void) | undefined;
  return {
    service,
    view,
    async start(): Promise<void> {
      unbind = view.bind();
      unbindActions = actions.bind(dependencies.doc);
      // The router loads the configuration when the page opens, as it always has.
    },
    async load(): Promise<void> {
      if (!dependencies.doc.getElementById('tool-guard-rules') || !dependencies.canRead()) return;
      try {
        await service.load();
        view.render();
        view.loadFeedback(null);
      } catch (error) {
        view.loadFeedback((error as Error).message, true);
      }
    },
    dispose(): void {
      unbind?.();
      unbindActions?.();
      view.dispose();
    },
  };
}
