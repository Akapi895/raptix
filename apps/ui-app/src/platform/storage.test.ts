import { describe, expect, it } from 'vitest';
import { createStorage } from './storage';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe('storage boundary', () => {
  it('roundtrips raw values without interpreting corrupt JSON', () => {
    const port = memoryStorage();
    const storage = createStorage(() => port);
    expect(storage.get('missing')).toBeNull();
    expect(storage.set('state', '{bad json')).toBe(true);
    expect(storage.get('state')).toBe('{bad json');
    expect(storage.set('state', '')).toBe(true);
    expect(storage.get('state')).toBe('');
    expect(storage.remove('state')).toBe(true);
    expect(storage.get('state')).toBeNull();
  });

  it('survives denied access to the provider and retries lazily', () => {
    const port = memoryStorage();
    let denied = true;
    const storage = createStorage(() => {
      if (denied) throw new DOMException('Denied', 'SecurityError');
      return port;
    });
    expect(storage.get('key')).toBeNull();
    expect(storage.set('key', 'value')).toBe(false);
    expect(storage.remove('key')).toBe(false);
    denied = false;
    expect(storage.set('key', 'value')).toBe(true);
    expect(storage.get('key')).toBe('value');
  });

  it('survives method failures, including quota exhaustion', () => {
    const fail = (): never => { throw new DOMException('Quota', 'QuotaExceededError'); };
    const storage = createStorage(() => ({ ...memoryStorage(), getItem: fail, setItem: fail, removeItem: fail }));
    expect(storage.get('key')).toBeNull();
    expect(storage.set('key', 'value')).toBe(false);
    expect(storage.remove('key')).toBe(false);
  });
});
