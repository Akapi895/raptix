import type { AssetsDependencies } from './contracts';
import { createAssetsService } from './service';
import { createAssetsView } from './view';
export * from './contracts';
export { action, bindActions, createDOM, toast, icon } from './dom';
export type { ActionHandler } from './dom';
export type { Asset, AssetInput, ProjectOption } from './model';
export { isIPv4, isIPv6, normalizeDomain } from './model';
export function initAssets(doc: Document, deps: AssetsDependencies) {
  const service = createAssetsService(deps), view = createAssetsView(doc, service, deps);
  return { service, view, activate: view.activate, dispose: view.dispose };
}
