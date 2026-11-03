import { browser } from '@/platform/browser';

/** Owns resources created by composition, in addition to each feature's resources. */
export function createDomainLifetime() {
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const timers = new Map<number, (() => void) | undefined>();
  const frames = new Set<number>();
  const later = (callback: () => void, delay: number, cancelled?: () => void): number => {
    if (disposed) { cancelled?.(); return 0; }
    const id = browser.setTimeout(() => { timers.delete(id); if (!disposed) callback(); }, delay);
    timers.set(id, cancelled); return id;
  };
  return {
    get disposed() { return disposed; },
    later,
    sleep: (delay: number) => new Promise<void>(resolve => { later(resolve, delay, resolve); }),
    frame(callback: () => void) {
      if (disposed) return;
      const id = browser.requestAnimationFrame(() => { frames.delete(id); if (!disposed) callback(); });
      frames.add(id);
    },
    on(target: EventTarget, name: string, listener: EventListener, options?: AddEventListenerOptions) {
      if (disposed) return;
      target.addEventListener(name, listener, options);
      cleanups.push(() => target.removeEventListener(name, listener, options));
    },
    dispose() {
      if (disposed) return; disposed = true;
      cleanups.splice(0).reverse().forEach(stop => stop());
      timers.forEach((cancel, id) => { browser.clearTimeout(id); cancel?.(); }); timers.clear();
      frames.forEach(browser.cancelAnimationFrame); frames.clear();
    },
  };
}
