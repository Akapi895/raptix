import { browser } from '@/platform/browser';
import { translateRuntime } from '@/i18n';

/** Resources belong to one application instance, including deferred work during teardown. */
export function createChatResources() {
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const timers = new Set<number>();
  const intervals = new Set<number>();
  const frames = new Set<number>();
  return {
    get disposed() { return disposed; },
    own(cleanup: () => void) { if (disposed) cleanup(); else cleanups.push(cleanup); },
    on(target: EventTarget, type: string, listener: EventListener) {
      target.addEventListener(type, listener);
      cleanups.push(() => target.removeEventListener(type, listener));
    },
    later(callback: () => void, ms: number): number {
      const id = browser.setTimeout(() => { timers.delete(id); if (!disposed) callback(); }, ms);
      timers.add(id);
      return id;
    },
    clearTimer(handle: number | ReturnType<typeof setTimeout>) { const id = Number(handle); browser.clearTimeout(id); timers.delete(id); },
    every(callback: () => void, ms: number): number {
      const id = browser.setInterval(() => { if (!disposed) callback(); }, ms);
      intervals.add(id);
      return id;
    },
    frame(callback: FrameRequestCallback): number {
      if (disposed) return 0;
      const id = browser.requestAnimationFrame(time => { frames.delete(id); if (!disposed) callback(time); });
      frames.add(id); return id;
    },
    cancelFrame(id: number) { browser.cancelAnimationFrame(id); frames.delete(id); },
    dispose() {
      if (disposed) return;
      disposed = true;
      timers.forEach(browser.clearTimeout);
      intervals.forEach(browser.clearInterval);
      frames.forEach(browser.cancelAnimationFrame);
      cleanups.splice(0).reverse().forEach(stop => stop());
      timers.clear(); intervals.clear(); frames.clear();
    },
  };
}
export type ChatResources = ReturnType<typeof createChatResources>;
export const t = (key: string, fallback: string, values?: Record<string, unknown>): string => {
  const value = translateRuntime(key, values as never);
  return value && value !== key ? value : fallback;
};
export const translate = (key: string, values?: Record<string, unknown>): string => translateRuntime(key, values as never);
