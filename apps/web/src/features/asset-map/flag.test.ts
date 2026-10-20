import { afterEach, describe, expect, it } from 'vitest'
import { isAssetMapEnabled } from './flag'

afterEach(() => globalThis.localStorage?.removeItem('raptix.assetMap'))

describe('isAssetMapEnabled', () => {
  it('is off by default', () => {
    expect(isAssetMapEnabled()).toBe(false)
  });

  it('turns on only for an explicit opt-in in this browser', () => {
    globalThis.localStorage.setItem('raptix.assetMap', '1')
    expect(isAssetMapEnabled()).toBe(true)
    globalThis.localStorage.setItem('raptix.assetMap', '0')
    expect(isAssetMapEnabled()).toBe(false)
  });
});
