import './styles';
import { createSharedUi } from './app/shared-ui';
import { createApplication } from './app/application';
import { registerMarkupActions } from './app/markup-actions';
import { installSelectionTooltip } from './ui/selection-tooltip';
import { installInlineActions } from './ui/inline-actions';

const cleanups: (() => void | Promise<void>)[] = [];
let disposed = false;
let disposal: Promise<void> | undefined;
function dispose(): Promise<void> {
  if (disposal) return disposal;
  disposed = true;
  delete document.documentElement.dataset.appReady;
  disposal = (async () => {
    const errors: unknown[] = [];
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) console.error('Raptix teardown failed', errors);
  })();
  return disposal;
}
import.meta.hot?.dispose(data => { data.disposal = dispose(); });

async function main(): Promise<void> {
  // Await the previous module's shutdown before HMR creates new subscriptions.
  await (import.meta.hot?.data.disposal as Promise<void> | undefined);
  if (disposed) return;
  document.documentElement.dataset.appReady = 'loading';
  if (__MOCK_ENABLED__) {
    const { startDemo } = await import('./main.dev');
    if (disposed) return;
    cleanups.push(startDemo());
  }
  const shared = await createSharedUi();
  if (disposed) { shared.dispose(); return; }
  cleanups.push(shared.dispose);
  const application = createApplication(Promise.resolve());
  cleanups.push(application.dispose);
  cleanups.push(installSelectionTooltip());
  cleanups.push(registerMarkupActions(application));
  cleanups.push(installInlineActions(document, application.domains.auth.requirePermission));
  shared.start();
  await application.start();
  if (!disposed) document.documentElement.dataset.appReady = 'true';
}

void main().catch(async error => {
  await dispose();
  console.error('Raptix startup failed', error);
  document.documentElement.dataset.appReady = 'error';
});
