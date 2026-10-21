import { afterEach, expect, it } from 'vitest'
import { clearCaptureRequest, captureRequestId } from './capture-session'

afterEach(() => window.localStorage.clear())

it('reuses one request ID for an uncertain upload and isolates it by actor and engagement', () => {
  const first = captureRequestId('deployment-a', 'actor-a', 'eng-1', 'sha256:abc')
  expect(captureRequestId('deployment-a', 'actor-a', 'eng-1', 'sha256:abc')).toBe(first)
  expect(captureRequestId('deployment-a', 'actor-b', 'eng-1', 'sha256:abc')).not.toBe(first)
  expect(captureRequestId('deployment-a', 'actor-a', 'eng-2', 'sha256:abc')).not.toBe(first)
  clearCaptureRequest('deployment-a', 'actor-a', 'eng-1', 'sha256:abc')
  expect(captureRequestId('deployment-a', 'actor-a', 'eng-1', 'sha256:abc')).not.toBe(first)
})
