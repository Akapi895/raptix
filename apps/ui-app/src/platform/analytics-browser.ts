export const analyticsBrowser = {
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  hash: () => window.location.hash,
  setHash: (hash: string): void => { window.location.hash = hash; },
  download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); }
    finally { URL.revokeObjectURL(url); }
  },
};
