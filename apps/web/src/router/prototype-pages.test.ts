/**
 * Prototype and QA pages are registered only where the build allows them (quick win UX-05). The flag is read once per
 * module load, so each case re-imports the route declaration under its own environment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const PROTOTYPE_KEYS = ['states', 'scenarios', 'workspaces'] as const

describe('prototype pages gate', () => {
  it('registers the prototype and QA routes in the development server', async () => {
    vi.stubEnv('DEV', true)
    const { ROUTES } = await import('./routes')
    for (const key of PROTOTYPE_KEYS) expect(ROUTES).toHaveProperty([key])
  })

  it('leaves them unregistered in a deployed build', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_PROTOTYPE_PAGES', '')
    const { ROUTES } = await import('./routes')
    for (const key of PROTOTYPE_KEYS) expect(ROUTES).not.toHaveProperty([key])
    expect(ROUTES).toHaveProperty(['overview'])
  })

  it('registers them in a deployed build that opts in', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_PROTOTYPE_PAGES', 'true')
    const { ROUTES } = await import('./routes')
    for (const key of PROTOTYPE_KEYS) expect(ROUTES).toHaveProperty([key])
  })
})
