/** Browser capabilities only. Application state and feature APIs never live here. */
export const browser = {
  get events(): EventTarget { return window; },
  get document(): Document { return document; },
  get location() {
    return {
      get hash(): string { return window.location.hash; },
      set hash(value: string) { window.location.hash = value; },
      get pathname(): string { return window.location.pathname; },
      get search(): string { return window.location.search; },
      get origin(): string { return window.location.origin; },
      get href(): string { return window.location.href; },
    };
  },
  on(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): () => void {
    window.addEventListener(type, listener, options);
    return () => window.removeEventListener(type, listener, options);
  },
  dispatch(event: Event): boolean { return window.dispatchEvent(event); },
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  get visualViewport(): VisualViewport | null { return window.visualViewport; },
  get scrollY(): number { return window.scrollY; },
  alert: (message: string): void => window.alert(message),
  confirm: (message: string): boolean => window.confirm(message),
  prompt: (message: string, initial?: string): string | null => window.prompt(message, initial),
  matchMedia: (query: string): MediaQueryList => window.matchMedia(query),
  requestAnimationFrame: (callback: FrameRequestCallback): number => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (id: number): void => window.cancelAnimationFrame(id),
  setTimeout: (callback: () => void, ms: number): number => window.setTimeout(callback, ms),
  clearTimeout: (id: number | undefined): void => window.clearTimeout(id),
  setInterval: (callback: () => void, ms: number): number => window.setInterval(callback, ms),
  clearInterval: (id: number | undefined): void => window.clearInterval(id),
  clipboard: { writeText: (text: string): Promise<void> => navigator.clipboard.writeText(text) },
  open: (url: string, target = '_blank', features = 'noopener'): void => { window.open(url, target, features); },
  reload: (): void => window.location.reload(),
  visit: (url: string): void => { window.location.href = url; },
  replaceUrl: (url: string): void => window.history.replaceState(null, '', url),
  pushUrl: (url: string): void => window.history.pushState(null, '', url),
  scrollTo: (options: ScrollToOptions): void => window.scrollTo(options),
  getSelection: (): Selection | null => window.getSelection(),
};

export type BrowserCapabilities = typeof browser;
