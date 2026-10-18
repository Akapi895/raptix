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
import * as api from '../api'

vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), getThread: vi.fn() }))

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
    expect(post.body).toMatchObject({ body: 'Check the admin panel.', expectedAttempt: 1 })
    expect((post.body as { messageId: string }).messageId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('cancels the running attempt and says the stop is only recorded, not observed', async () => {
    const calls = stubFetch(MAILBOX('running'), () => new Response(JSON.stringify({ threadId: 'thread-1', dispatchId: 'dispatch-recon', attempt: 1, state: 'cancel_requested' }), { status: 202 }))
    renderMessenger()
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel attempt' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Cancel recorded.')
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toContain('/instances/thread-1/dispatch-recon/cancel')
    expect(post.body).toEqual({ expectedAttempt: 1 })
  })

  it('closes sending for a finished attempt and says why', async () => {
    stubFetch(MAILBOX('finished'))
    renderMessenger()
    expect(await screen.findByText(/This attempt is finished/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send to instance' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel attempt' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry attempt' })).toBeInTheDocument()
  })

  it('shows a runtime refusal in the server’s own words', async () => {
    stubFetch(MAILBOX('running'), () => new Response(JSON.stringify({ error: { code: 'conflict', message: 'This instance is not running, so the message was not accepted.' } }), { status: 409 }))
    renderMessenger()
    await userEvent.type(await screen.findByRole('textbox'), 'too late')
    await userEvent.click(screen.getByRole('button', { name: 'Send to instance' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This instance is not running, so the message was not accepted.')
  })

  it('resends a message whose ACK was lost under the same client id', async () => {
    const posts: { messageId: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        if (posts.length === 1) throw new TypeError('Failed to fetch')
        return new Response(JSON.stringify({ status: 'accepted', attempt: 1, message: { ...MESSAGE, messageId: posts[0].messageId, body: 'Check the admin panel.', state: 'accepted' } }), { status: 202 })
      }
      return new Response(JSON.stringify(MAILBOX('running')), { status: 200 })
    }))
    renderMessenger()
    await userEvent.type(await screen.findByRole('textbox'), 'Check the admin panel.')
    await userEvent.click(screen.getByRole('button', { name: 'Send to instance' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send to instance' }))
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].messageId).toBe(posts[0].messageId)
  })

  it('does not record a message twice when the lost ACK had already landed', async () => {
    let recorded: unknown[] = []
    let posts = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1
        const { messageId } = JSON.parse(String(init.body)) as { messageId: string }
        recorded = [{ ...MESSAGE, messageId, body: 'Check the admin panel.', state: 'accepted' }]
        throw new TypeError('Failed to fetch')
      }
      return new Response(JSON.stringify(MAILBOX('running', recorded)), { status: 200 })
    }))
    renderMessenger()
    await userEvent.type(await screen.findByRole('textbox'), 'Check the admin panel.')
    await userEvent.click(screen.getByRole('button', { name: 'Send to instance' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send to instance' }))
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
    expect(posts).toBe(1)
  })

  it('pins the open question this attempt asked and leaves another instance question out', async () => {
    const question = (questionId: string, text: string, dispatchId: string) => ({
      questionId, question: text, header: 'Scope', options: [], multiSelect: false, allowOther: true, source: 'runtime', instance: { dispatchId, attempt: 1 },
    })
    vi.mocked(api.getThread).mockResolvedValue({ pendingQuestions: [question('q-mine', 'Which login form should recon test?', DISPATCH), question('q-other', 'Use the staging host?', 'dispatch-other')] } as never)
    stubFetch(MAILBOX('running'))
    renderMessenger()
    expect(await screen.findByText('Which login form should recon test?')).toBeInTheDocument()
    expect(screen.queryByText('Use the staging host?')).not.toBeInTheDocument()
  })
})
