import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { CreateProjectInput } from '../../src/types'

let storage: Map<string, string>
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())
const input: CreateProjectInput = { displayName: 'Validated demo', workspaceSlug: 'validated-demo', targetType: 'web_url', targetValue: 'https://authorized.example', authorizationConfirmed: true }

describe('mock project contract', () => {
  it('rejects duplicate slugs and keeps workspace identity stable when metadata is edited', async () => {
    const adapter = await import('../../src/mocks/adapters/projects')
    const project = adapter.createMockProject(input)
    adapter.updateMockProject(project.id, { name: 'Renamed display name' })
    expect(() => adapter.createMockProject(input)).toThrow(/already exists/)
    const persisted = JSON.parse(storage.get('raptix.mock.projects.v1')!)
    expect(persisted.find((candidate: { id: string }) => candidate.id === project.id).workspaceSlug).toBe('validated-demo')
  })
  it('reports malformed stored projects instead of trusting missing required fields', async () => {
    storage.set('raptix.mock.projects.v1', JSON.stringify([{ id: 'broken', name: 'Broken schema', members: [] }]))
    const adapter = await import('../../src/mocks/adapters/projects')
    expect(adapter.getProjectPersistenceError()).toMatch(/storage|saved|schema/i)
  })
  it('rejects invalid target schemes and unconfirmed authorization at the repository boundary', async () => {
    const adapter = await import('../../src/mocks/adapters/projects')
    expect(() => adapter.createMockProject({ ...input, targetValue: 'javascript:alert(1)' })).toThrow(/target/i)
    expect(() => adapter.createMockProject({ ...input, authorizationConfirmed: false })).toThrow(/authorization/i)
  })
})
