/** Browser-only capabilities shared by the shell; no feature state lives here. */
export const shellBrowser = {
  get hash(): string { return location.hash; },
  get origin(): string { return location.origin; },
  get width(): number { return innerWidth; },
  get height(): number { return innerHeight; },
  get viewport(): VisualViewport | null { return window.visualViewport; },
  pushHash(hash: string): void { history.pushState(null, '', '#' + hash); },
  replaceHash(hash: string): void { history.replaceState(null, '', '#' + hash); },
  onHash(listener: () => void): () => void {
    window.addEventListener('hashchange', listener);
    window.addEventListener('popstate', listener);
    return () => { window.removeEventListener('hashchange', listener); window.removeEventListener('popstate', listener); };
  },
  on(type: string, listener: EventListener, capture = false): () => void {
    window.addEventListener(type, listener, capture);
    return () => window.removeEventListener(type, listener, capture);
  },
  media(query: string): MediaQueryList { return matchMedia(query); },
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> { return fetch(input, init); },
  xhr(): XMLHttpRequest { return new XMLHttpRequest(); },
  confirm(message: string): boolean { return confirm(message); },
  alert(message: string): void { alert(message); },
  open(url: string): void { window.open(url, '_blank', 'noopener'); },
  visit(url: string): void { location.href = url; },
  reload(): void { location.reload(); },
  async copy(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const input = document.createElement('textarea');
      input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
      document.body.append(input); input.select();
      try { if (!document.execCommand('copy')) throw new Error('Copy failed'); }
      finally { input.remove(); }
    }
  },
  async fullscreen(): Promise<void> {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) await exit.call(doc);
    } else {
      const enter = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!enter) throw new Error('Fullscreen unavailable');
      await enter.call(root);
    }
  },
  download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
};
