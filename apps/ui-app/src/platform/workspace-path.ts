export interface WorkspacePath {
  read(): string;
  write(id: string): void;
}

// The active project is a path segment ("/<id>/"), sibling to the hash-routed page
// ("#page?query"). Writing it with replaceState keeps the hash and history entry count
// untouched -- only router-browser.ts owns pushing/replacing hash-only navigation.
export function createWorkspacePath(win?: Window): WorkspacePath {
  // Resolved lazily, inside the try/catch below: evaluating `window` eagerly as a default
  // parameter would throw at import time in non-browser test environments.
  const target = () => win ?? window;
  function read(): string {
    try {
      const match = /^\/([^/]+)\/?$/.exec(target().location.pathname);
      return match ? decodeURIComponent(match[1]!) : '';
    } catch { return ''; }
  }
  function write(id: string): void {
    try {
      if (read() === id) return;
      const path = id ? '/' + encodeURIComponent(id) + '/' : '/';
      const browser = target();
      browser.history.replaceState(browser.history.state, '', path + browser.location.hash);
    } catch { /* sandboxed browsers may block history writes */ }
  }
  return { read, write };
}

export const workspacePath = createWorkspacePath();
