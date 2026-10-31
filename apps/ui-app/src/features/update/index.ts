import { createUpdateClient } from './client';
import { createUpdateService } from './service';
import { createUpdateView } from './view';
import type { UpdateDependencies } from './types';
export type { UpdateDependencies } from './types';
export function initUpdate(document: Document, deps: UpdateDependencies) {
  const view = createUpdateView(document, deps), service = createUpdateService(createUpdateClient(deps.request), deps, view.render);
  let unbind: (() => void) | undefined;
  return { service, activate() { unbind ??= view.bind(service); }, dispose() { unbind?.(); service.dispose(); } };
}
