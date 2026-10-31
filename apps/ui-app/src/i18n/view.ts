import { changeLanguage, normalizeLanguage } from './index';
import type { Actions } from '@/ui/actions';

export function closeLanguageDropdown(): void {
  const dropdown = document.getElementById('lang-dropdown');
  if (dropdown) dropdown.style.display = 'none';
}

export function toggleLanguageDropdown(): void {
  const dropdown = document.getElementById('lang-dropdown');
  if (dropdown) dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

export function selectLanguage(language: string): void {
  void changeLanguage(normalizeLanguage(language));
  closeLanguageDropdown();
}

export function initLanguageActions(actions: Actions): () => void {
  const disposers = [
    actions.register('language.toggle', toggleLanguageDropdown),
    actions.register('language.select', element => {
      selectLanguage(element.dataset.lang ?? 'en-US');
    }),
  ];
  const outside = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest('.lang-switcher')) closeLanguageDropdown();
  };
  document.addEventListener('click', outside);
  return () => {
    disposers.forEach(dispose => dispose());
    document.removeEventListener('click', outside);
  };
}
