import type { Translate } from './types';

export function storageText(translate: Translate, key: string, fallback: string): string {
  const fullKey = `settingsStorage.${key}`;
  const value = translate(fullKey);
  return value && value !== fullKey ? value : fallback;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
