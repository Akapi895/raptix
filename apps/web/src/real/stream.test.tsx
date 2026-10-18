/** SSE run-event stream tests (tickets 04-05): cursor replay, malformed frames, control frames. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicStreamEvent } from '@raptix/web-contracts'

const { act, renderHook } = await import('@testing-library/react')
const { useRunStream } = await import('./stream')

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  private listeners = new Map<string, ((frame: MessageEvent) => void)[]>()
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: EventListener): void {
    const list = this.listeners.get(type) ?? []
    list.push(cb as (frame: MessageEvent) => void)
    this.listeners.set(type, list)
  }
  close(): void { this.closed = true }
  emit(type: string, data: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) cb({ data: JSON.stringify(data) } as MessageEvent)
  }
  emitRaw(type: string, data: string): void {
    for (const cb of this.listeners.get(type) ?? []) cb({ data } as MessageEvent)
  }
}

const EVENT: PublicStreamEvent = {
  version: 1, eventId: 'ev-1', engagementId: 'eng-1', threadId: 'th-1', streamRunId: 'run-1', runId: 'run-1',
  source: 'runtime', namespace: [], occurredAt: '2026-10-14T08:00:00.000Z', observedAt: '2026-10-14T08:00:00.500Z',
  identity: 'occurrence',
  payload: { type: 'message', messageId: 'm-1', role: 'assistant', content: 'hello', mode: 'delta', truncated: false },
}

afterEach(() => {
  FakeEventSource.instances = []
  vi.unstubAllGlobals()
})

describe('useRunStream', () => {
  it('subscribes to the scoped run event endpoint and delivers validated events', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn()
    const { result } = renderHook(() => useRunStream({ engagementId: 'eng-1', threadId: 'th-1', runId: 'run-1', onEvent }))
    const source = FakeEventSource.instances[0]
    expect(source.url).toBe('/api/engagements/eng-1/threads/th-1/runs/run-1/events')
    await act(async () => {
      source.onopen?.()
      source.emit('run-event', EVENT)
    })
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(result.current.eventCount).toBe(1)
    expect(result.current.connected).toBe(true)
  })

  it('counts malformed frames instead of rendering them', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn()
    const { result } = renderHook(() => useRunStream({ engagementId: 'eng-1', threadId: 'th-1', runId: 'run-1', onEvent }))
    const source = FakeEventSource.instances[0]
    await act(async () => {
      source.emitRaw('run-event', 'not json at all')
      source.emitRaw('run-event', JSON.stringify({ version: 1, nonsense: true }))
      source.emit('run-event', EVENT)
    })
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(result.current.malformedCount).toBe(2)
    expect(result.current.eventCount).toBe(1)
  })

  it('forwards control frames as recovery requirements and closes on unmount', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onControl = vi.fn()
    const { unmount } = renderHook(() => useRunStream({ engagementId: 'eng-1', threadId: 'th-1', runId: 'run-1', onEvent: () => {}, onControl }))
    const source = FakeEventSource.instances[0]
    await act(async () => { source.emitRaw('control', JSON.stringify({ type: 'stream_closed', recoveryRequired: true })) })
    expect(onControl).toHaveBeenCalledWith('stream_closed', true)
    await act(async () => { source.emitRaw('control', JSON.stringify({ type: 'stream_closed', recoveryRequired: false })) })
    expect(onControl).toHaveBeenLastCalledWith('stream_closed', false)
    unmount()
    expect(source.closed).toBe(true)
  })

  it('closes the source when the server ends the stream so EventSource does not replay the run', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onControl = vi.fn()
    renderHook(() => useRunStream({ engagementId: 'eng-1', threadId: 'th-1', runId: 'run-1', onEvent: () => {}, onControl }))
    const source = FakeEventSource.instances[0]
    await act(async () => { source.emitRaw('control', JSON.stringify({ type: 'stream_closed', recoveryRequired: false })) })
    expect(source.closed).toBe(true)
    expect(onControl).toHaveBeenCalledWith('stream_closed', false)
  })

  it('does not subscribe without a run', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    renderHook(() => useRunStream({ engagementId: 'eng-1', threadId: 'th-1', runId: null, onEvent: () => {} }))
    expect(FakeEventSource.instances).toHaveLength(0)
  })
})
