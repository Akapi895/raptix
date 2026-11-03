/** Navigation primitives; capability changes are delivered to their application owner. */
export function createSettingsBrowser(onC2Enabled: (enabled: boolean) => void = () => {}) {
  return {
    events: window,
    viewport: () => ({ width: window.innerWidth || document.documentElement.clientWidth, height: window.innerHeight || document.documentElement.clientHeight }),
    settingsHash(section: string) { if (window.location.hash.split('?')[0] === '#settings') window.history.replaceState(null, '', section === 'token-usage' ? '#settings?section=token-usage' : '#settings'); },
    c2Enabled: onC2Enabled,
    dispose() {},
  };
}
