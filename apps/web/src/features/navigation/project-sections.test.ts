import { describe, expect, it } from 'vitest'
import { projectMenu, resolveProjectTab, type ProjectMode } from './project-sections'

const MODES: ProjectMode[] = ['mock', 'real']
const items = (mode: ProjectMode) => projectMenu(mode).flatMap((group) => group.items)

describe('project sections table', () => {
  it.each(MODES)('gives every menu item in %s a tab id that no other item uses', (mode) => {
    const tabs = items(mode).map((item) => item.to)
    expect(new Set(tabs).size).toBe(tabs.length)
  })

  it.each(MODES)('resolves every canonical tab of %s to itself', (mode) => {
    for (const item of items(mode)) {
      expect(resolveProjectTab(item.to, mode), `${mode}:${item.to}`).toBe(item.to)
    }
  })

  it('gives the same label to every section that both modes show', () => {
    const labels = (mode: ProjectMode) => new Set(items(mode).map((item) => item.label))
    const shared = [...labels('mock')].filter((label) => labels('real').has(label))
    expect(shared).toEqual(expect.arrayContaining(['Overview', 'Scope & ROE', 'Assets', 'Planning', 'AI Workspace', 'Operations', 'C2 Sessions', 'Findings', 'Reports', 'Team & Approvals', 'Activity & Audit', 'Vault', 'Closeout']))
  })

  it('keeps the mock and real planning and sessions sections on their own tab ids', () => {
    expect(items('mock').find((item) => item.label === 'Planning')?.to).toBe('plans')
    expect(items('real').find((item) => item.label === 'Planning')?.to).toBe('planning')
    expect(items('mock').find((item) => item.label === 'C2 Sessions')?.to).toBe('sessions')
    expect(items('real').find((item) => item.label === 'C2 Sessions')?.to).toBe('c2')
  })
})
