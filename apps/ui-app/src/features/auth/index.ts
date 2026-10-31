import { createActions, type Actions } from '../../ui/actions';
import { createAuthService, type AuthService } from './service';
import { createAuthView, type AuthView } from './view';
import type { AuthViewDependencies } from './view';

export { createAuthService } from './service';
export type { AuthService, AuthSnapshot, AuthUser, LoginResult, RobotBinding } from './service';
export { createAuthView } from './view';
export { PAGE_PERMISSION_MAP, elementAllowed, hasAnyPermission, pagePermission } from './permissions';

export interface AuthFeature {
  service: AuthService;
  view: AuthView;
  /** Restore a valid session, bind the login/user-menu controls and apply RBAC. */
  start(): Promise<void>;
  dispose(): void;
}

export type AuthFeatureDependencies = Omit<AuthViewDependencies, 'service' | 'actions'> & {
  actions?: Actions;
};

/**
 * Composition root for the auth feature. The app shell calls `start()` once the
 * page is mounted; `onAuthenticated` runs the app bootstrap (chat, tasks, ...).
 */
export function initAuth(dependencies: AuthFeatureDependencies, service: AuthService = createAuthService()): AuthFeature {
  const actions = dependencies.actions ?? createActions();
  const view = createAuthView({ ...dependencies, service, actions });
  let unbind: (() => void) | undefined;
  let unbindActions: (() => void) | undefined;
  let started = false;
  return {
    service,
    view,
    async start(): Promise<void> {
      if (started) return;
      started = true;
      unbind = view.bind();
      unbindActions = actions.bind(dependencies.doc);
      const restored = service.restore();
      if (restored && (await service.validate())) {
        view.hideLoginOverlay();
        view.applyRbac(dependencies.doc);
        await dependencies.onAuthenticated(true);
        return;
      }
      view.showLoginOverlay(null);
    },
    dispose(): void {
      unbind?.();
      unbindActions?.();
      view.dispose();
    },
  };
}
