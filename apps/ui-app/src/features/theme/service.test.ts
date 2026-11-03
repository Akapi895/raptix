import { describe, expect, it, vi } from 'vitest';
import { createThemeService } from './service';
import type { KeyValueStorage } from '@/platform/storage';

function store(initial: string | null, writable = true): KeyValueStorage {
  let value = initial;
  return {
    get: () => value,
    set: (_key, next) => { if (writable) value = next; return writable; },
    remove: () => { value = null; return true; },
  };
}

describe('theme preference', () => {
  it('resolves invalid preferences against the system and reacts to system changes', () => {
    let dark = false;
    const theme = createThemeService(store('invalid'), () => dark);
    const listener = vi.fn();
    const stop = theme.subscribe(listener);
    expect(theme.snapshot()).toEqual({ preference: 'system', resolved: 'light' });
    dark = true;
    theme.refresh();
    expect(listener).toHaveBeenLastCalledWith({ preference: 'system', resolved: 'dark' });
    theme.set('light');
    expect(theme.snapshot()).toEqual({ preference: 'light', resolved: 'light' });
    stop();
    listener.mockClear();
    theme.refresh();
    expect(listener).not.toHaveBeenCalled();
  });

  it('cycles and persists explicit preferences across service instances', () => {
    const storage = store(null);
    const theme = createThemeService(storage, () => true);
    for (const preference of ['light', 'dark', 'system']) {
      theme.cycle();
      expect(theme.get()).toBe(preference);
      expect(createThemeService(storage, () => false).get()).toBe(preference);
    }
  });

  it('retains the in-memory preference and cycle position when persistence is blocked', () => {
    const theme = createThemeService(store('dark', false), () => false);
    theme.set('light');
    theme.refresh();
    expect(theme.snapshot()).toEqual({ preference: 'light', resolved: 'light' });
    theme.cycle();
    expect(theme.get()).toBe('dark');
    theme.cycle();
    expect(theme.snapshot()).toEqual({ preference: 'system', resolved: 'light' });
  });
});
