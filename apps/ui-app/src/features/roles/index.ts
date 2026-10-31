import { http } from '../../platform/http';
import type { KeyValueStorage } from '../../platform/storage';
import { createActions, type Actions } from '../../ui/actions';
import { createRoleToolsEditor } from './editor';
import { createRolesService, type RequestFn } from './service';
import { createRolesView, type RolesViewDeps } from './view';

export { createRolesService, RoleError } from './service';
export { createRoleToolsEditor } from './editor';
export { createRolesView } from './view';
export { decodeRoleIcon, encodeRoleIcon, sortRoles, toolKey, DEFAULT_ROLE, RoleToolSelection, type Role, type RoleTool } from './model';

export interface RolesFeatureDependencies extends Omit<RolesViewDeps, 'doc' | 'service' | 'editor' | 'actions'> {
  doc: Document;
  storage: KeyValueStorage;
  request?: RequestFn;
  actions?: Actions;
}

export interface RolesFeature {
  service: ReturnType<typeof createRolesService>;
  editor: ReturnType<typeof createRoleToolsEditor>;
  view: ReturnType<typeof createRolesView>;
  /** Binds the chat selector, the roles page and the editor. Safe to call once after classic scripts load. */
  activate(): void;
  dispose(): void;
}

/** Composition root: the transport is the platform client; the storage holds the chat's current role. */
export function initRoles(dependencies: RolesFeatureDependencies): RolesFeature {
  const { doc, storage } = dependencies;
  const service = createRolesService({
    request: dependencies.request ?? ((path, init) => http.raw(path, init)),
    storage,
  });
  const editor = createRoleToolsEditor({ service, storage });
  const actions = dependencies.actions ?? createActions();
  const view = createRolesView({ ...dependencies, doc, service, editor, actions });
  let unbind: (() => void) | undefined;
  let unbindActions: (() => void) | undefined;
  return {
    service,
    editor,
    view,
    activate(): void {
      if (unbind) return;
      unbindActions = actions.bind(doc);
      unbind = view.bind();
      view.renderChatSelector();
    },
    dispose(): void {
      unbind?.();
      unbindActions?.();
      unbind = undefined;
      unbindActions = undefined;
    },
  };
}
