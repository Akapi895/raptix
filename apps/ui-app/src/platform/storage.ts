export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): boolean;
}

// Resolve lazily: even accessing window.localStorage can throw in sandboxed
// browsers. Feature modules never need to repeat try/catch or touch window.
export function createStorage(provider: () => Storage): KeyValueStorage {
  return {
    get(key) {
      try { return provider().getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { provider().setItem(key, value); return true; } catch { return false; }
    },
    remove(key) {
      try { provider().removeItem(key); return true; } catch { return false; }
    },
  };
}

export const storage = createStorage(() => window.localStorage);
export const sessionStorage = createStorage(() => window.sessionStorage);
