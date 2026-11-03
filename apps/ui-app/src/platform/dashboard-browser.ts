// Browser primitives only. Kept outside the feature so its service can run with a fake clock.
export const dashboardBrowser = {
  now: () => Date.now(),
  every: (callback: () => void, ms: number): number => window.setInterval(callback, ms),
  cancelEvery: (id: number): void => window.clearInterval(id),
  later: (callback: () => void, ms: number): number => window.setTimeout(callback, ms),
  cancelLater: (id: number | undefined): void => window.clearTimeout(id),
  frame: (callback: FrameRequestCallback): number => window.requestAnimationFrame(callback),
  cancelFrame: (id: number): void => window.cancelAnimationFrame(id),
  viewportWidth: (): number => window.innerWidth,
  reducedMotion: (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  setHash: (hash: string): void => { window.location.hash = hash; },
};
