import { translateRuntime } from '../../i18n';
import { http } from '../../platform/http';
import { createActions, type Actions } from '../../ui/actions';
import { createVaultService, type VaultService } from './service';
import { createVaultView, type VaultView } from './view';

export { createVaultService, VaultError } from './service';
export { normalizeSecret, isRevoked } from './model';
export type { VaultSecret } from './model';
export { createVaultView } from './view';

export interface VaultFeatureDependencies {
  doc: Document;
  actions?: Actions;
  canRead(): boolean;
  canWrite(): boolean;
  translate?: (key: string, params?: Record<string, string | number>) => string;
}

export interface VaultFeature {
  service: VaultService;
  view: VaultView;
  start(): Promise<void>;
  /** Called by the router each time the vault page opens. */
  load(): Promise<void>;
  dispose(): void;
}

/** Composition root: the transport is the platform client, copy comes from the i18n resources. */
export function initVault(dependencies: VaultFeatureDependencies): VaultFeature {
  const translate = dependencies.translate ?? ((key: string, params?: Record<string, string | number>) => {
    const value = translateRuntime(`vault.${key}`, params as never);
    return String(value);
  });
  const service = createVaultService({ transport: http, t: translate });
  const actions = dependencies.actions ?? createActions();
  const view = createVaultView({
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
    },
    async load(): Promise<void> {
      if (!dependencies.doc.getElementById('vault-secrets') || !dependencies.canRead()) return;
      try {
        if (!service.state.projects.length) await service.loadProjects();
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
