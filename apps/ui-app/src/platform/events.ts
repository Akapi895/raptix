export function createEvents<Events extends object>() {
  const target = new EventTarget();
  return {
    on<Key extends keyof Events & string>(type: Key, handler: (detail: Events[Key]) => void): () => void {
      const listener = (event: Event) => handler((event as CustomEvent<Events[Key]>).detail);
      target.addEventListener(type, listener);
      return () => target.removeEventListener(type, listener);
    },
    emit<Key extends keyof Events & string>(type: Key, detail: Events[Key]): void {
      target.dispatchEvent(new CustomEvent(type, { detail }));
    },
  };
}

export const transportEvents = createEvents<{
  'session-expired': { url: string };
  forbidden: { url: string };
}>();
