import { applyTranslations, initI18n } from '@/i18n';
import { initLanguageActions } from '@/i18n/view';
import { initTheme, theme } from '@/features/theme';
import { createActions } from '@/ui/actions';

/** Shared controls have their own lifecycle on both HTML entry points. */
export async function createSharedUi() {
  const actions = createActions();
  await initI18n();
  const cleanup = [initTheme(actions), initLanguageActions(actions), actions.bind(document)];
  let disposed = false;
  return {
    start(): void {
      if (disposed) return;
      applyTranslations();
      theme.refresh();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cleanup.reverse().forEach(stop => stop());
    },
  };
}
