import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { session } from './session';
import type { SocketPort } from './ws';

export type TerminalRenderer = Pick<Terminal, 'cols' | 'rows' | 'open' | 'write' | 'writeln' | 'clear' | 'focus' | 'scrollToBottom' | 'onData' | 'onResize' | 'dispose'>;
export interface TerminalFit { fit(): void }

/** Browser capabilities only; no feature state or legacy application globals. */
export const terminalBrowser = {
  location: () => ({ protocol: location.protocol, host: location.host }),
  token: () => session.read()?.token ?? null,
  socketFactory: (url: string): SocketPort => new WebSocket(url),
  createTerminal(options: ITerminalOptions): { terminal: TerminalRenderer; fit: TerminalFit } {
    const terminal = new Terminal(options);
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    return { terminal, fit };
  },
  listenResize(listener: () => void): () => void {
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  },
};
