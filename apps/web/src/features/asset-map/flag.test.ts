import { afterEach, describe, expect, it } from 'vitest'
import { isAssetMapEnabled } from './flag'

afterEach(() => {
  globalThis.localStorage?.removeItem('raptix.assetMap')
  window.history.replaceState(null, '', '/')
})

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

  it('turns on from the address, before the hash, and keeps the opt-in for later loads', () => {
    window.history.replaceState(null, '', '/?assetMap=1#/project/eng-1?tab=overview')
    expect(isAssetMapEnabled()).toBe(true)
    window.history.replaceState(null, '', '/#/project/eng-1?tab=overview')
    expect(isAssetMapEnabled()).toBe(true)
  });

  it('turns on from the address, inside the hash query', () => {
    window.history.replaceState(null, '', '/#/project/eng-1?tab=overview&assetMap=1')
    expect(isAssetMapEnabled()).toBe(true)
  });

  it('turns off from the address and forgets the opt-in', () => {
    globalThis.localStorage.setItem('raptix.assetMap', '1')
    window.history.replaceState(null, '', '/?assetMap=0')
    expect(isAssetMapEnabled()).toBe(false)
    window.history.replaceState(null, '', '/')
    expect(isAssetMapEnabled()).toBe(false)
  });

  it('ignores other values in the address, so the default stays off', () => {
    window.history.replaceState(null, '', '/?assetMap=yes')
    expect(isAssetMapEnabled()).toBe(false)
  });
});
