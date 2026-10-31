/** Browser capabilities only; business and transitional dependencies are injected. */
export const projectsBrowser = {
  confirm: (message: string): boolean => window.confirm(message),
  prompt: (message: string, value = ''): string | null => window.prompt(message, value),
  alert: (message: string): void => window.alert(message),
  hash: (): string => window.location.hash,
  setHash: (hash: string): void => { window.location.hash = hash; },
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  canPreview: (): boolean => !window.matchMedia('(max-width: 900px), (hover: none)').matches,
  frame: (callback: () => void): number => window.requestAnimationFrame(callback),
  on(type: string, listener: EventListener, capture = false): () => void {
    window.addEventListener(type, listener, capture);
    return () => window.removeEventListener(type, listener, capture);
  },
};
