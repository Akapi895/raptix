/** Data-mode resolution + real-mode bootstrap tests (ticket 03, ADR-0068). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'raptix.dataMode'

async function loadMode() {
  vi.resetModules()
  return await import('./mode')
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(() => vi.unstubAllEnvs())

describe('resolveDataMode / DATA_MODE', () => {
  it('defaults to mock mode', async () => {
    expect((await loadMode()).DATA_MODE).toBe('mock')
  })

  it('honours the VITE_DATA_MODE build default', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'real')
    expect((await loadMode()).DATA_MODE).toBe('real')
  })

  it('localStorage preference beats the build default', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'mock')
    window.localStorage.setItem(KEY, 'real')
    expect((await loadMode()).DATA_MODE).toBe('real')
  })

  it('the explicit ?dataMode= parameter wins over everything', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'real')
    window.localStorage.setItem(KEY, 'mock')
    window.history.replaceState(null, '', '/?dataMode=mock')
    expect((await loadMode()).DATA_MODE).toBe('mock')
  })

  it('ignores invalid values at every precedence level', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'nonsense')
    window.localStorage.setItem(KEY, 'also-nonsense')
    window.history.replaceState(null, '', '/?dataMode=banana')
    expect((await loadMode()).DATA_MODE).toBe('mock')
  })

  it('switchDataMode persists the choice and no-ops for the current mode', async () => {
    const m = await loadMode()
    m.switchDataMode('mock')
    expect(window.localStorage.getItem(KEY)).toBeNull()
    m.switchDataMode('real')
    expect(window.localStorage.getItem(KEY)).toBe('real')
  })
})
