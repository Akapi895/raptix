import { createTerminalView, type TerminalDependencies } from './view';
export type { TerminalDependencies } from './view';
export { createTerminalConnection, buildTerminalURL } from './service';
export type { TerminalConnectionOptions } from './service';

export function initTerminalFeature(document: Document, dependencies: TerminalDependencies) {
  return createTerminalView(document, dependencies);
}
export type TerminalFeature = ReturnType<typeof initTerminalFeature>;
