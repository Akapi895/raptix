import './styles/style.css';
import { createSharedUi } from './app/shared-ui';
import { browser } from './platform/browser';
import { shellBrowser } from './platform/shell-browser';
import { storage } from './platform/storage';
import { http } from './platform/http';
import { applyTranslations, translateRuntime, type TranslationOptions } from './i18n';
import { initApiDocs } from './features/api-docs';

/** The token the page was opened with: the signed-in session if still valid, else the older key. */
function readToken(): string | null {
  try {
    const raw = storage.get('raptix-auth');
    if (raw) {
      const parsed = JSON.parse(raw) as { token?: string; expiresAt?: string } | null;
      if (parsed?.token) {
        const expiry = parsed.expiresAt ? new Date(parsed.expiresAt) : null;
        if (!expiry || expiry.getTime() > Date.now()) return parsed.token;
      }
    }
    return storage.get('swagger_auth_token');
  } catch (error) {
    console.error('Failed to load token:', error);
    return null;
  }
}

const disposers: (() => void)[] = [];
let disposed = false;
function dispose(): void {
  disposed = true;
  delete document.documentElement.dataset.appReady;
  disposers.splice(0).reverse().forEach(stop => stop());
}
import.meta.hot?.dispose(dispose);

async function main(): Promise<void> {
  document.documentElement.dataset.appReady = 'loading';
  if (__MOCK_ENABLED__) {
    const { startDemo } = await import('./main.dev');
    disposers.push(startDemo());
  }
  const sharedUi = await createSharedUi();
  if (disposed) { sharedUi.dispose(); return; }
  disposers.push(sharedUi.dispose);
  const feature = initApiDocs({
    doc: document,
    readToken,
    request: (url, init) => http.raw(url, init),
    origin: () => browser.location.origin,
    t: (key: string, params?: Record<string, string | number>) => translateRuntime(key, params as TranslationOptions | undefined),
    copy: shellBrowser.copy,
    alert: browser.alert,
    applyTranslations: root => applyTranslations(root),
  });
  disposers.push(feature.dispose);
  feature.activate();
  sharedUi.start();
  await feature.load();
  if (!disposed) document.documentElement.dataset.appReady = 'true';
}

void main().catch(error => {
  dispose();
  console.error('Raptix API docs startup failed', error);
  document.documentElement.dataset.appReady = 'error';
});
