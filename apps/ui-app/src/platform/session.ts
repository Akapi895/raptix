import { z } from 'zod';
import { storage, type KeyValueStorage } from './storage';

// Browser persistence uses expiresAt; the wire format returns expires_at.
export const storedSessionSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
  user: z.object({ id: z.string(), username: z.string(), display_name: z.string().optional() }).nullable().optional(),
  roles: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  scope: z.string().default(''),
});

export type StoredSession = z.infer<typeof storedSessionSchema>;

export function createSessionStore(store: KeyValueStorage, now = Date.now) {
  const key = 'raptix-auth';
  return {
    read(): StoredSession | null {
      const raw = store.get(key);
      if (raw === null) return null;
      try {
        const value = storedSessionSchema.parse(JSON.parse(raw));
        if (Date.parse(value.expiresAt) > now()) return value;
      } catch { /* Invalid/old persisted state is not a valid session. */ }
      store.remove(key);
      return null;
    },
    save(value: StoredSession): boolean {
      return store.set(key, JSON.stringify(storedSessionSchema.parse(value)));
    },
    clear(): void { store.remove(key); },
  };
}

export const session = createSessionStore(storage);
