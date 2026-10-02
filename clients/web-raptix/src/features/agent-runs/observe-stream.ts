import { decodeSse } from '@raptix/streaming'
import { isPublicStreamEvent, isScopedRunView, isScopedThreadView } from '@raptix/web-contracts'
import type { PublicStreamEvent, ScopedRunView, ScopedThreadView, StreamScope } from '@raptix/web-contracts'
import { apiBaseUrl } from '../../app/config'
import { encodePathSegment, requestJson } from '../../shared/api/http'
import { ApiInvalidResponseError, ApiNetworkError } from '../../shared/api/errors'

export interface ObserveOptions {
  scope: StreamScope; signal: AbortSignal; cursor?: string; baseUrl?: string
  onEvent(event: PublicStreamEvent): void
  onRecovery(run: ScopedRunView, snapshot: ScopedThreadView): void
  onTransport(state: 'connected' | 'disconnected'): void
}
function cursor(value: unknown): value is string { return typeof value === 'string' && /^(?:-1|[A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$/.test(value) }
export async function observeRunStream(options: ObserveOptions): Promise<{ cursor?: string; recoveryRequired: boolean }> {
  const { scope, signal } = options
  const base = (options.baseUrl ?? apiBaseUrl).replace(/\/$/, '')
  const path = `/engagements/${encodePathSegment(scope.engagementId)}/threads/${encodePathSegment(scope.threadId)}/runs/${encodePathSegment(scope.runId)}`
  let last = options.cursor
  if (last !== undefined && !cursor(last)) throw new ApiInvalidResponseError('Invalid stream cursor')
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    try {
      const response = await fetch(`${base}${path}/events`, { signal, headers: last === undefined ? undefined : { 'Last-Event-ID': last } })
      if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new ApiNetworkError()
      options.onTransport('connected')
      for await (const frame of decodeSse(response.body)) {
        if (frame.id !== undefined) { if (!cursor(frame.id)) throw new ApiInvalidResponseError('Invalid upstream cursor'); last = frame.id }
        if (frame.event === 'run-event') {
          const event: unknown = JSON.parse(frame.data)
          if (!isPublicStreamEvent(event) || event.engagementId !== scope.engagementId || event.threadId !== scope.threadId || event.streamRunId !== scope.runId) throw new ApiInvalidResponseError('Stream event scope or payload mismatch')
          if (event.upstreamCursor !== frame.id) throw new ApiInvalidResponseError('Event identity cannot replace an upstream cursor')
          options.onEvent(event)
        }
      }
    } catch (error) {
      if (signal.aborted) return { cursor: last, recoveryRequired: true }
      if (error instanceof ApiInvalidResponseError) { options.onTransport('disconnected'); throw error }
    }
    options.onTransport('disconnected')
    if (signal.aborted) return { cursor: last, recoveryRequired: true }
    const [run, snapshot] = await Promise.all([
      requestJson<unknown>(base, path, { signal }),
      requestJson<unknown>(base, `/engagements/${encodePathSegment(scope.engagementId)}/threads/${encodePathSegment(scope.threadId)}`, { signal }),
    ])
    if (!isScopedRunView(run) || !isScopedThreadView(snapshot) || run.engagementId !== scope.engagementId || run.threadId !== scope.threadId || run.runId !== scope.runId || snapshot.binding.engagementId !== scope.engagementId || snapshot.binding.threadId !== scope.threadId) throw new ApiInvalidResponseError('Stream recovery scope mismatch')
    options.onRecovery(run, snapshot)
    if (['success', 'error', 'timeout', 'interrupted'].includes(run.rawStatus)) return { cursor: last, recoveryRequired: false }
  }
  return { cursor: last, recoveryRequired: true }
}
