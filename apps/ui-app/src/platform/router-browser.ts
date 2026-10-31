import type { RouterPort } from '@/router/service';

/** URL writes intentionally do not dispatch hashchange. The service emits once. */
export function createRouterBrowserPort(root: Document = document): RouterPort {
  return {
    readHash: () => window.location.hash,
    replaceHash: hash => window.history.replaceState(null, '', '#' + hash),
    onHash(listener) {
      window.addEventListener('hashchange', listener);
      return () => window.removeEventListener('hashchange', listener);
    },
    canActivate: page => !!root.getElementById('page-' + page),
  };
}

/** Transitional synchronous boundary for a callback that still persists its own
 * hash. Delegate same-document replacements to the router, retaining other History
 * operations. Only active for the duration of that callback, never across await. */
export function delegateHashReplacements<T>(callback: () => T, replace: (hash: string) => void): T {
  const history = window.history;
  const original = history.replaceState;
  const delegated: History['replaceState'] = (data: unknown, unused: string, url?: string | URL | null) => {
    const target = url == null ? null : new URL(url, window.location.href);
    if (target && target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) {
      // RouterPort uses the real History method, avoiding recursive delegation.
      history.replaceState = original;
      try { replace(target.hash); } finally { history.replaceState = delegated; }
    } else original.call(history, data, unused, url);
  };
  history.replaceState = delegated;
  try { return callback(); } finally { history.replaceState = original; }
}
