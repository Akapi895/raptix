import { theme, type ThemePreference, type ResolvedTheme } from './service';
import { t, type TranslationKey } from '@/i18n';
import { onSystemThemeChange } from '@/platform/appearance';
import type { Actions } from '@/ui/actions';

const titles: Record<ThemePreference, TranslationKey> = {
  system: 'theme.titleSystem', light: 'theme.titleLight', dark: 'theme.titleDark',
};
const labels: Record<ThemePreference, TranslationKey> = {
  system: 'theme.system', light: 'theme.light', dark: 'theme.dark',
};

function render({ preference, resolved }: { preference: ThemePreference; resolved: ResolvedTheme }): void {
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const button = document.getElementById('theme-toggle-btn');
  if (button) {
    button.dataset.themePreference = preference;
    button.dataset.theme = resolved;
    button.title = t(titles[preference]);
    button.setAttribute('aria-label', button.title);
  }
  const label = document.getElementById('theme-toggle-label');
  if (label) label.textContent = t(labels[preference]);
  document.dispatchEvent(new CustomEvent('raptix-themechange', { detail: { preference, resolved } }));
}

export function initTheme(actions: Actions): () => void {
  const dispose = [
    theme.subscribe(render),
    actions.register('theme.cycle', () => theme.cycle()),
    onSystemThemeChange(() => { if (theme.get() === 'system') theme.refresh(); }),
  ];
  const refresh = () => theme.refresh();
  document.addEventListener('languagechange', refresh);
  refresh();
  return () => {
    dispose.forEach(stop => stop());
    document.removeEventListener('languagechange', refresh);
  };
}
