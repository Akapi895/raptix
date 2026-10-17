/**
 * Operator messages to a running dispatch (P10c): the runtime's delivery state per message, a send
 * with a client message id, sending closed for a finished attempt, and a refusal shown in the
 * server's words.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstanceMessenger } from './instance-messenger'

const THREAD = 'thread-1'
const DISPATCH = 'dispatch-recon'
const MESSAGE = { messageId: 'm-1', attempt: 1, seq: 1, body: 'Focus on the login form.', state: 'delivered', acceptedAt: '2026-10-18T00:00:00+00:00', deliveredAt: '2026-10-18T00:00:05+00:00', handledAt: null, outcome: null }
const MAILBOX = (state: 'running' | 'finished', messages: unknown[] = [MESSAGE]) => ({
  threadId: THREAD, dispatchId: DISPATCH, source: 'runtime',
  instances: [{ attempt: 1, role: 'recon', state, startedAt: '2026-10-18T00:00:00+00:00', finishedAt: state === 'finished' ? '2026-10-18T00:10:00+00:00' : null }],
  messages,
})

function stubFetch(mailbox: unknown, post?: (body: unknown) => Response) {
  const calls: { method: string; url: string; body?: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    if (method === 'POST' && post) return post(JSON.parse(String(init?.body)))
    if (method === 'GET' && url.includes('/messages')) return new Response(JSON.stringify(mailbox), { status: 200 })
    return new Response('unexpected', { status: 404 })
  }))
  return calls
}

function renderMessenger(attempt = 1): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <InstanceMessenger engagementId="eng-1" threadId={THREAD} dispatchId={DISPATCH} attempt={attempt} />
    </QueryClientProvider>,
  )
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('InstanceMessenger (P10c)', () => {
  it('shows each message with the runtime’s own delivery state', async () => {
    stubFetch(MAILBOX('running'))
    renderMessenger()
    expect(await screen.findByText('Focus on the login form.')).toBeInTheDocument()
    expect(screen.getByText(/delivered to the instance/)).toBeInTheDocument()
  })

  it('sends with a client message id to the instance route and clears the draft', async () => {
    const calls = stubFetch(MAILBOX('running'), () => new Response(JSON.stringify({ status: 'accepted', attempt: 1, message: { ...MESSAGE, messageId: 'm-2', body: 'Check the admin panel.', state: 'accepted' } }), { status: 202 }))
    renderMessenger()
    await userEvent.type(await screen.findByRole('textbox'), 'Check the admin panel.')
    await userEvent.click(screen.getByRole('button', { name: 'Send to instance' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toContain('/instances/thread-1/dispatch-recon/messages')
    expect(post.body).toMatchObject({ body: 'Check the admin panel.' })
    expect((post.body as { messageId: string }).messageId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('closes sending for a finished attempt and says why', async () => {
    stubFetch(MAILBOX('finished'))
    renderMessenger()
    expect(await screen.findByText(/This attempt is finished/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows a runtime refusal in the server’s own words', async () => {
    stubFetch(MAILBOX('running'), () => new Response(JSON.stringify({ error: { code: 'conflict', message: 'This instance is not running, so the message was not accepted.' } }), { status: 409 }))
    renderMessenger()
    await userEvent.type(await screen.findByRole('textbox'), 'too late')
    await userEvent.click(screen.getByRole('button', { name: 'Send to instance' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This instance is not running, so the message was not accepted.')
  })
})
