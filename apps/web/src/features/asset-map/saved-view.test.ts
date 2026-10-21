import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSavedSelection, loadSavedView, saveSelection } from './saved-view'

const key = 'raptix.assetMap.selected.user-1.eng-1'

beforeEach(() => {
  globalThis.localStorage.clear()
})

afterEach(() => {
  globalThis.localStorage.clear()
})

describe('saved view', () => {
  it('keeps the asset and the camera per user and project', () => {
    saveSelection('user-1', 'eng-1', 'asset_a', { zoom: 1.25, x: 10, y: -5 })
    expect(loadSavedView('user-1', 'eng-1')).toEqual({ assetId: 'asset_a', camera: { zoom: 1.25, x: 10, y: -5 } })
    expect(loadSavedView('user-2', 'eng-1')).toBeNull()
    expect(loadSavedView('user-1', 'eng-2')).toBeNull()
    expect(globalThis.localStorage.getItem(key)).toContain('asset_a')
  })

  it('still restores an asset saved before the camera was stored', () => {
    globalThis.localStorage.setItem(key, 'asset_old')
    expect(loadSavedView('user-1', 'eng-1')).toEqual({ assetId: 'asset_old', camera: null })
    expect(loadSavedSelection('user-1', 'eng-1')).toBe('asset_old')
  })

  it('ignores a damaged value and a camera with a missing coordinate', () => {
    globalThis.localStorage.setItem(key, '{not json')
    expect(loadSavedView('user-1', 'eng-1')).toBeNull()
    globalThis.localStorage.setItem(key, JSON.stringify({ assetId: 'asset_a', camera: { zoom: 1, x: 3 } }))
    expect(loadSavedView('user-1', 'eng-1')).toEqual({ assetId: 'asset_a', camera: null })
  })

  it('does nothing without a signed-in user', () => {
    saveSelection(null, 'eng-1', 'asset_a')
    expect(globalThis.localStorage.length).toBe(0)
    expect(loadSavedView(null, 'eng-1')).toBeNull()
  })
})
