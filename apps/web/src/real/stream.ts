/**
 * Scoped run-event stream for real mode (integration tickets 04-05).
 *
 * The server exposes `GET /api/engagements/:id/threads/:thread/runs/:run/events`
 * as an SSE stream of validated `PublicStreamEvent`s (`run-event` frames),
 * `cursor` keep-alives and `control` frames (`stream_closed`/`stream_error` —
 * recovery required). EventSource owns reconnection and replays with the
 * `Last-Event-ID` header automatically; every payload is validated at the
 * boundary and malformed frames are counted, never rendered.
 */
import { useEffect, useRef, useState } from 'react'
import { isPublicStreamEvent, type PublicStreamEvent } from '@raptix/web-contracts'

export interface RunStreamOptions {
  engagementId: string
  threadId: string
  /** Null disables the subscription (no active run to observe). */
  runId: string | null
  onEvent: (event: PublicStreamEvent) => void
  /** A control frame means the stream ended; `recoveryRequired` is false for a normal end such as a run waiting for an answer. */
  onControl?: (type: 'stream_closed' | 'stream_error', recoveryRequired: boolean) => void
}

export interface RunStreamState {
  connected: boolean
  eventCount: number
  malformedCount: number
}

const isControlFrame = (value: unknown): value is { type: 'stream_closed' | 'stream_error'; recoveryRequired?: boolean } => {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as Record<string, unknown>).type
  return type === 'stream_closed' || type === 'stream_error'
}

/** Subscribes to one run's event stream while `runId` is set. */
export function useRunStream({ engagementId, threadId, runId, onEvent, onControl }: RunStreamOptions): RunStreamState {
  const [state, setState] = useState<RunStreamState>({ connected: false, eventCount: 0, malformedCount: 0 })
  const onEventRef = useRef(onEvent)
  const onControlRef = useRef(onControl)
  const scopeRef = useRef('')
  scopeRef.current = `${engagementId}/${threadId}/${runId ?? ''}`
  onEventRef.current = onEvent
  onControlRef.current = onControl

  useEffect(() => {
    if (!runId) {
      setState({ connected: false, eventCount: 0, malformedCount: 0 })
      return
    }
    const url = `/api/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/events`
    const source = new EventSource(url)
    const scope = `${engagementId}/${threadId}/${runId}`
    const isCurrent = (): boolean => !disposed && scopeRef.current === scope
    let disposed = false
    const seen = new Set<string>()
    let events = 0
    let malformed = 0
    const acceptFrame = (frame: MessageEvent): void => {
      if (!isCurrent()) return
      let parsed: unknown
      try {
        parsed = JSON.parse(typeof frame.data === 'string' ? frame.data : '')
      } catch {
        malformed++
        setState({ connected: true, eventCount: events, malformedCount: malformed })
        return
      }
      if (isPublicStreamEvent(parsed) && parsed.engagementId === engagementId && parsed.threadId === threadId && parsed.streamRunId === runId) {
        if (seen.has(parsed.eventId)) return
        seen.add(parsed.eventId)
        events++
        setState({ connected: true, eventCount: events, malformedCount: malformed })
        onEventRef.current(parsed)
      } else {
        malformed++
        setState({ connected: true, eventCount: events, malformedCount: malformed })
      }
    }
    source.addEventListener('run-event', acceptFrame as EventListener)
    source.addEventListener('control', (frame) => {
      if (!isCurrent()) return
      source.close()
      setState((s) => ({ ...s, connected: false }))
      let type: 'stream_closed' | 'stream_error' = 'stream_error'
      let recoveryRequired = true
      try {
        const parsed = JSON.parse((frame as MessageEvent).data as string) as unknown
        if (isControlFrame(parsed)) {
          type = parsed.type
          recoveryRequired = parsed.recoveryRequired !== false
        }
      } catch {
        // A malformed control frame still requires recovery.
      }
      onControlRef.current?.(type, recoveryRequired)
    })
    source.onopen = () => { if (isCurrent()) setState((s) => ({ ...s, connected: true })) }
    source.onerror = () => {
      if (isCurrent()) {
        setState((s) => ({ ...s, connected: false }))
        onControlRef.current?.('stream_error', true)
      }
    }
    return () => { disposed = true; source.close() }
  }, [engagementId, threadId, runId])

  return state
}
