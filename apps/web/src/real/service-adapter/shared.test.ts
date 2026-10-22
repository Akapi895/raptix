/** Adapter boundary (P01): transport failures become typed results, while a caller's abort is never shown as a failure. */
import { describe, expect, it } from 'vitest'
import { ApiTransportError } from '../../platform/transport'
import { failureFrom, guarded } from '../../platform/adapter-shared'

describe('failureFrom', () => {
  it('maps transport statuses onto the console failure kinds', () => {
    expect(failureFrom(new ApiTransportError(409, 'conflict', 'stale version')).kind).toBe('conflict')
    expect(failureFrom(new ApiTransportError(403, 'forbidden', 'no access')).kind).toBe('forbidden')
    expect(failureFrom(new ApiTransportError(0, 'unavailable', 'down')).kind).toBe('unavailable')
  })
})

describe('guarded', () => {
  it('turns a transport error into an explicit failure result', async () => {
    const result = await guarded(async () => { throw new ApiTransportError(409, 'conflict', 'stale version') })
    expect(result).toEqual({ ok: false, failure: { kind: 'conflict', message: 'stale version' } })
  })

  it('lets a caller abort propagate instead of reporting it as unavailable', async () => {
    const controller = new AbortController()
    const pending = guarded(() => new Promise((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not turn a late acknowledgement into a visible failure after the caller switched away', async () => {
    const controller = new AbortController()
    const late = guarded(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      return { ok: true as const, data: 'accepted' }
    })
    controller.abort()
    const outcome = await late.then((result) => ({ settled: 'resolved' as const, result }), (error: unknown) => ({ settled: 'rejected' as const, error }))
    expect(outcome.settled).toBe('rejected')
    expect((outcome as { error: { name: string } }).error.name).toBe('AbortError')
  })
})
