/** Browser-only capabilities used by the mobile shell. No feature dependencies. */
export function createMobileBrowser() {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767.98px)') : null;
  return {
    events: window as EventTarget,
    media,
    viewport: window.visualViewport,
    width: () => window.innerWidth,
    height: () => window.innerHeight,
    hash: () => window.location.hash,
    rememberPage(page: string) { try { window.localStorage.setItem('csaiMobileTab', page); } catch { /* Private storage is optional. */ } },
    navigate: (url: string) => { window.location.href = url; },
    reload: () => window.location.reload(),
    async fullscreen(): Promise<boolean> {
      const doc: Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void | Promise<void> } = document;
      const root: HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> } = doc.documentElement;
      try {
        if (doc.fullscreenElement || doc.webkitFullscreenElement) {
          const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
          if (exit) await exit.call(doc);
          return true;
        }
        const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
        if (!request) return false;
        await request.call(root);
        return true;
      } catch { return false; }
    },
  };
}
