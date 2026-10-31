import { storage, type KeyValueStorage } from '@/platform/storage';
import { createEvents } from '@/platform/events';
import { systemIsDark } from '@/platform/appearance';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
const preferences: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function createThemeService(store: KeyValueStorage, isDark: () => boolean) {
  const events = createEvents<{ change: { preference: ThemePreference; resolved: ResolvedTheme } }>();
  const stored = store.get('raptix-theme');
  let preference: ThemePreference = stored === 'dark' || stored === 'light' ? stored : 'system';
  function get(): ThemePreference {
    return preference;
  }
  function snapshot() {
    const preference = get();
    const resolved: ResolvedTheme = preference === 'system' ? isDark() ? 'dark' : 'light' : preference;
    return { preference, resolved };
  }
  function refresh(): void { events.emit('change', snapshot()); }
  function set(value: ThemePreference): void {
    preference = preferences.includes(value) ? value : 'system';
    store.set('raptix-theme', preference);
    refresh();
  }
  return {
    get, snapshot, set, refresh,
    cycle(): void { set(preferences[(preferences.indexOf(get()) + 1) % preferences.length] ?? 'system'); },
    subscribe: (listener: (state: ReturnType<typeof snapshot>) => void) => events.on('change', listener),
  };
}

export const theme = createThemeService(storage, systemIsDark);
