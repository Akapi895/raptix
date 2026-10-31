import i18next, { type TOptions } from 'i18next';
import en from './resources/en-US.json';
import { storage } from '@/platform/storage';

export type Language = 'en-US';
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string | number | readonly unknown[] ? K
    : T[K] extends object ? `${K}.${LeafPaths<T[K]>}` : never
}[keyof T & string];
export type TranslationKey = LeafPaths<typeof en>;
export type TranslationOptions = Omit<TOptions, 'context'> & { context?: string };

export const i18n = i18next.createInstance();
const key = 'csai_lang';
const translationListeners = new Set<() => void>();

export function onTranslationsApplied(listener: () => void): () => void {
  translationListeners.add(listener);
  return () => { translationListeners.delete(listener); };
}

export function normalizeLanguage(_value: string | null | undefined): Language {
  // English is the only bundled language; anything else resolves to en-US.
  return 'en-US';
}

export function currentLanguage(): Language {
  return normalizeLanguage(i18n.language);
}

// Runtime keys are needed only for data-i18n and the temporary legacy adapter.
// New TypeScript callers use t(), whose key is checked against en-US.json.
export function translateRuntime(key: string, options?: TranslationOptions | null): string {
  const value: unknown = i18n.t(key, options ?? {});
  return typeof value === 'string' ? value : key;
}

export function t(key: TranslationKey, options?: TranslationOptions | null): string {
  return translateRuntime(key, options);
}

export function applyTranslations(root: ParentNode | null = document): void {
  root ??= document;
  const elements = [...root.querySelectorAll<HTMLElement>('[data-i18n]')];
  if (root instanceof HTMLElement && root.matches('[data-i18n]')) elements.unshift(root);
  elements.forEach(element => {
    const key = element.dataset.i18n;
    if (!key) return;
    const translated = translateRuntime(key);
    const text = translated && translated !== key ? translated : '';
    const control = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
    if (element.dataset.i18nSkipText !== 'true' && !control && !element.querySelector('*') && text) {
      element.textContent = text;
    }
    element.dataset.i18nAttr?.split(',').map(attr => attr.trim()).filter(Boolean).forEach(attr => {
      let value = text;
      if (attr === 'title' && element.dataset.i18nTitle) {
        const title = translateRuntime(element.dataset.i18nTitle);
        if (title && title !== element.dataset.i18nTitle) value = title;
      }
      if (value) element.setAttribute(attr, value);
    });
  });
  const input = document.querySelector<HTMLTextAreaElement>('#chat-input');
  if (input?.placeholder.trim() && input.value.trim() === input.placeholder.trim()) input.value = '';
  document.documentElement.lang = currentLanguage();
  translationListeners.forEach(listener => listener());
}

function updateLabel(): void {
  const label = document.getElementById('current-lang-label');
  if (label) label.textContent = t('lang.enUS');
}

export async function changeLanguage(language: Language): Promise<void> {
  if (language === currentLanguage()) return;
  await i18n.changeLanguage(language);
  storage.set(key, language);
  applyTranslations();
  updateLabel();
  document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: language } }));
}

export async function initI18n(): Promise<void> {
  if (i18n.isInitialized) return;
  await i18n.init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    resources: { 'en-US': { translation: en } },
    debug: false,
  });
  applyTranslations();
  updateLabel();
}
