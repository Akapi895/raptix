/** Real asynchronous bootstrap must keep routing live under React StrictMode. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'

window.history.replaceState(null, '', '/?dataMode=real#/projects')
vi.stubEnv('VITE_DATA_MODE', 'real')
const { default: App } = await import('../App')
const { getActiveRouter } = await import('../router/active')
const { resetNavStores } = await import('../router/navigate')

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('retains the active router after StrictMode cleanup and follows hash navigation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/auth/session') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(url.endsWith('/capabilities')
    ? { version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true }, agents: { supported: false, available: false } } }
    : []), { status: 200 })))
  const ui = render(<StrictMode><App /></StrictMode>)
  await screen.findByRole('heading', { name: 'Projects' })
  expect(getActiveRouter()).not.toBeNull()
  await act(async () => { window.location.hash = '#/ai-operator/eng-1' })
  await screen.findByRole('heading', { name: 'AI Workspace' })
  ui.unmount()
  expect(getActiveRouter()).toBeNull()
})

it('opens the real task inbox instead of a transitional not-connected page', async () => {
  window.history.replaceState(null, '', '/?dataMode=real#/tasks')
  resetNavStores()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true } } }))
    if (url.endsWith('/tasks')) return new Response(JSON.stringify({ engagements: [], tasks: [], counts: {}, source: 'db' }))
    if (url.endsWith('/auth/session')) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify([]))
  }))
  render(<App />)
  await screen.findByRole('heading', { name: 'Tasks' })
  expect(screen.queryByText('Not connected in real mode')).toBeNull()
})
