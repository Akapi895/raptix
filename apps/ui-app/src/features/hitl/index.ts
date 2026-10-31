import { createHitlService } from './service';
import { createHitlView } from './view';
import type { HitlDependencies } from './types';

export { createHitlService, HitlApiError } from './service';
export { normalizeMode, normalizeReviewer, normalizeTimeout, normalizeBackend, parsePayload, auditEngineFromItem } from './model';
export type * from './types';

export function initHitl(doc: Document, dependencies: HitlDependencies) {
  const service = createHitlService(dependencies);
  const view = createHitlView(doc, service, dependencies);
  let ready: Promise<void> | undefined;
  let disposed = false;
  return {
    service, view,
    // Do not rely on DOMContentLoaded: the classic runtime fires ready callbacks
    // synchronously while it is still defining optional chat/monitor dependencies.
    afterClassicScripts(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (ready) return ready;
      view.bind();
      ready = (async () => {
        try {
          await service.fetchDefaultConfig(); if (disposed) return;
          if (!dependencies.getCurrentConversationId()) dependencies.refreshConfigByCurrentConversation?.();
          view.refreshReviewerBar();
        } catch (error) { console.warn('initHitlDefaultReviewerFromServer', error); }
        if (!disposed) service.reconcileUI();
      })();
      return ready;
    },
    dispose(): void { disposed = true; view.dispose(); service.dispose(); },
  };
}
export type Hitl = ReturnType<typeof initHitl>;
