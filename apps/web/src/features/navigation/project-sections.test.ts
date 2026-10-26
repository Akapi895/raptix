import { describe, expect, it } from 'vitest'
import { projectMenu, resolveProjectTab } from './project-sections'

const items = () => projectMenu().flatMap((group) => group.items)

describe('project sections table', () => {
  it('gives every menu item a tab id that no other item uses', () => {
    const tabs = items().map((item) => item.to)
    expect(new Set(tabs).size).toBe(tabs.length)
  })

  it('resolves every canonical tab to itself', () => {
    for (const item of items()) {
      expect(resolveProjectTab(item.to), item.to).toBe(item.to)
    }
  })

  it('keeps Planning and Sessions on their tab ids, and resolves the legacy ids to them', () => {
    expect(items().find((item) => item.label === 'Planning')?.to).toBe('planning')
    expect(items().find((item) => item.label === 'Sessions')?.to).toBe('c2')
    expect(resolveProjectTab('plans')).toBe('planning')
    expect(resolveProjectTab('sessions')).toBe('c2')
  })
})
