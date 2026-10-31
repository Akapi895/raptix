import { createSettingsService } from './service';
import { createSettingsSelects } from './selects';
import { createSettingsView } from './view';
import { createSettingsController } from './controller';
import type { SettingsDependencies } from './types';

export { createSettingsService } from './service';
export { createSettingsClient } from './client';
export { createSettingsForms, SETTINGS_FIELDS, MODEL_IDS } from './forms';
export { createSettingsSelects } from './selects';
export * from './model';
export type { SettingsDependencies } from './types';
export function initSettings(deps: SettingsDependencies) {
  const service = createSettingsService(deps);
  const selects = createSettingsSelects(deps.doc, deps.t, deps.browser);
  const view = createSettingsView(deps.doc, service, selects, deps.t);
  const controller = createSettingsController(deps, service, view, selects);
  let disposed = false;
  return { service, selects, view, controller,
    activate() { if (!disposed) controller.activate(); },
    dispose() { if (disposed) return; disposed = true; controller.dispose(); service.dispose(); selects.dispose(); },
  };
}
export type SettingsFeature = ReturnType<typeof initSettings>;
