import type { AssetsDependencies } from '../assets';
import { createInfoCollectService } from './service';
import { createInfoCollectView } from './view';
export { resultToAsset } from './service';
export type { SearchPayload, ResultRow } from './model';
export function initInfoCollect(doc: Document, deps: AssetsDependencies) { const service = createInfoCollectService(deps), view = createInfoCollectView(doc, service, deps); return { service, view, activate: view.activate, dispose: view.dispose }; }
