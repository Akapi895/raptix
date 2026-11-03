export type ActionHandler = (element: HTMLElement, event: Event) => void;
export type ActionEvent = 'click' | 'input' | 'change' | 'keydown' | 'submit';

export function createActions() {
  const handlers = new Map<string, ActionHandler>();
  return {
    register(name: string, handler: ActionHandler): () => void {
      if (handlers.has(name)) throw new Error(`Duplicate action: ${name}`);
      handlers.set(name, handler);
      return () => { handlers.delete(name); };
    },
    bind(root: HTMLElement | Document): () => void {
      const cleanup: (() => void)[] = [];
      for (const type of ['click', 'input', 'change', 'keydown', 'submit'] as const) {
        const attr = type === 'click' ? 'data-action' : `data-${type}`;
        const listener = (event: Event) => {
          const target = event.target instanceof Element ? event.target : null;
          const element = target?.closest<HTMLElement>(`[${attr}]`);
          if (!element || !root.contains(element)) return;
          if (element.matches(':disabled, [aria-disabled="true"]')) return;
          const name = element.getAttribute(attr);
          if (name) handlers.get(name)?.(element, event);
        };
        root.addEventListener(type, listener);
        cleanup.push(() => root.removeEventListener(type, listener));
      }
      return () => cleanup.forEach(dispose => dispose());
    },
  };
}

export type Actions = ReturnType<typeof createActions>;
