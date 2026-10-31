import { installMockTransport, mockBrowserEnvironment } from '../platform/mock-transport';
import { MockRuntime, type MockStorage } from './runtime';
import { registerAuth } from './routes/auth';
import { registerChat } from './routes/chat';
import { registerSecurity } from './routes/security';
import { registerPlatform } from './routes/platform';
import { connectTerminal } from './terminal';

export function createMock(options: { storage?: MockStorage; forceReset?: boolean; delayMs?: number } = {}): MockRuntime {
  const runtime = new MockRuntime(options.storage, options.forceReset, options.delayMs);
  registerAuth(runtime); registerChat(runtime); registerSecurity(runtime); registerPlatform(runtime);
  return runtime;
}
let installed = false;
export function installMock(): () => void {
  if (installed) return () => {};
  const runtime = createMock(mockBrowserEnvironment());
  runtime.seedSession();
  const dispose = installMockTransport({ dispatch: request => runtime.dispatch(request), connectSocket: connectTerminal, eventSourceHeartbeat: () => ({ type: 'heartbeat', message: '', data: {} }), reset: () => runtime.reset(), debug: runtime.debug });
  installed = true;
  return () => { if (!installed) return; installed = false; dispose(); };
}
