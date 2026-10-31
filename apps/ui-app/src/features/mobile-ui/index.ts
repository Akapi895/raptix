import { createMobileLifecycle } from './lifecycle';
import { createMobileView } from './view';
import { createMobileService } from './service';
import { createMobileController } from './controller';
import type { MobileDependencies } from './types';

export { createMobileService } from './service';
export type { MobileDependencies, MobileBrowser, MobileRequest } from './types';

export function initMobileUI(deps: MobileDependencies) {
  const life = createMobileLifecycle();
  const view = createMobileView(deps.doc, life, deps.translate);
  // This reference is resolved only by service.start/refresh, after construction.
  const service = createMobileService({ request: deps.request, enabled: () => controller.enabled(), loggedOut: () => controller.loggedOut(), onCount: view.setHitlBadge });
  const controller = createMobileController(deps, view, life, service);
  return {
    service,
    api: {
      isMobile: controller.isMobile,
      openDrawer: controller.openDrawer, closeDrawer: controller.closeDrawer,
      openChatDrawer: controller.openChatDrawer, closeChatDrawer: controller.closeChatDrawer,
      openSheet: controller.openSheet, closeSheet: controller.closeSheet,
      closeSelectionPanels: controller.closeSelectionPanels,
      refreshHitlBadge: service.refreshHitlBadge, wrapTables: controller.wrapTables, toast: controller.toast,
    },
    activate: controller.activate,
    onPageChanged: controller.onPageChanged,
    dispose() { service.dispose(); life.dispose(); },
  };
}
export type MobileUI = ReturnType<typeof initMobileUI>;
