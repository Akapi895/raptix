/** Own only individual DOM mutations, not a snapshot of the application's HTML.
 * This lets chat/settings continue rendering while mobile is mounted. */
export function createMobileLifecycle() {
  let disposed = false;
  const cleanup: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const frames = new Set<number>();
  const classes = new WeakMap<Element, Set<string>>();
  const styles = new WeakMap<HTMLElement, Set<string>>();
  function own(dispose: () => void) { if (disposed) dispose(); else cleanup.push(dispose); }
  return {
    own,
    get disposed() { return disposed; },
    on<E extends Event>(target: EventTarget, type: string, listener: (event: E) => void, options?: AddEventListenerOptions | boolean) {
      const handler = listener as EventListener;
      target.addEventListener(type, handler, options);
      own(() => target.removeEventListener(type, handler, options));
    },
    later(callback: () => void, delay: number) {
      const timer = setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, delay);
      timers.add(timer); return timer;
    },
    cancel(timer: ReturnType<typeof setTimeout> | undefined) { if (timer !== undefined) { clearTimeout(timer); timers.delete(timer); } },
    frame(callback: () => void) {
      const frame = requestAnimationFrame(() => { frames.delete(frame); if (!disposed) callback(); });
      frames.add(frame); return frame;
    },
    observe(target: Node, options: MutationObserverInit, callback: MutationCallback) {
      const observer = new MutationObserver((records, source) => { if (!disposed) callback(records, source); });
      observer.observe(target, options); own(() => observer.disconnect());
    },
    node<T extends Node>(node: T): T { own(() => node.parentNode?.removeChild(node)); return node; },
    class(node: Element, name: string, enabled: boolean) {
      let saved = classes.get(node);
      if (!saved) { saved = new Set(); classes.set(node, saved); }
      if (!saved.has(name)) {
        saved.add(name); const previous = node.classList.contains(name);
        own(() => node.classList.toggle(name, previous));
      }
      node.classList.toggle(name, enabled);
    },
    style(node: HTMLElement, property: string, value: string) {
      let saved = styles.get(node);
      if (!saved) { saved = new Set(); styles.set(node, saved); }
      if (!saved.has(property)) {
        saved.add(property);
        const previous = node.style.getPropertyValue(property), priority = node.style.getPropertyPriority(property);
        own(() => { if (previous) node.style.setProperty(property, previous, priority); else node.style.removeProperty(property); });
      }
      if (value) node.style.setProperty(property, value); else node.style.removeProperty(property);
    },
    dispose() {
      if (disposed) return; disposed = true;
      timers.forEach(clearTimeout); timers.clear(); frames.forEach(cancelAnimationFrame); frames.clear();
      cleanup.splice(0).reverse().forEach(dispose => dispose());
    },
  };
}
export type MobileLifecycle = ReturnType<typeof createMobileLifecycle>;
