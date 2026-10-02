import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

let storage: Map<string, string>
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())

describe('correct-source visual project repository', () => {
  it('preserves source members, roles and counts while creating a demo project', async () => {
    const adapter = await import('../../src/mocks/adapters/visual-projects')
    const project = adapter.createVisualProject('Visual project', 'Cloud Infrastructure', 'Demo client')
    expect(project.client).toBe('Demo client')
    expect(project.scopeType).toBe('Cloud Infrastructure')
    const saved = JSON.parse(storage.get('raptix.correct.visual-projects.v1')!)
    const acme = saved.find((candidate: { id: string }) => candidate.id === '1')
    expect(acme.members).toHaveLength(5)
    expect(acme.findings).toBe(12)
    expect(acme.assets).toBe(134)
    expect(saved.find((candidate: { id: string }) => candidate.id === '2').myRole).toBe('Member')
  })
  it('rejects incomplete visual form data without touching the old project storage', async () => {
    storage.set('raptix.mock.projects.v1', 'previous demo data')
    const adapter = await import('../../src/mocks/adapters/visual-projects')
    expect(() => adapter.createVisualProject('', 'Web Application', 'Demo client')).toThrow(/required/)
    expect(storage.get('raptix.mock.projects.v1')).toBe('previous demo data')
  })
})
