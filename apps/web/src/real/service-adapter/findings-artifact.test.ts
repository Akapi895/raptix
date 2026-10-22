import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api_findings from '../../features/findings/api';
import { createRealFindingService } from './findings'

vi.mock('../../features/findings/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/findings/api')>()
  return { ...actual, downloadCapture: vi.fn() }
})

const ctx = { actor: { id: 'u', role: 'operator' as const }, projectId: 'RT-1', corr: 'test' }
const original = new TextEncoder().encode('print("reproduce")\r\n')

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

beforeEach(() => {
  vi.mocked(api_findings.downloadCapture).mockReset()
})

describe('reproduction artifact reads', () => {
  it('returns the original bytes and their UTF-8 text when the digest matches the recorded one', async () => {
    const digest = await sha256Hex(original)
    vi.mocked(api_findings.downloadCapture).mockResolvedValue({ bytes: original, mediaType: 'text/x-python', filename: 'exploit.py', digest })

    const result = await createRealFindingService().readArtifact(ctx, { captureId: 'cap-7', filename: 'exploit.py', mediaType: 'text/x-python', digest, sizeBytes: original.length, classification: 'standard', canReadOriginal: true })

    if (!result.ok) throw new Error(result.failure.message)
    expect(Array.from(result.data.bytes)).toEqual(Array.from(original))
    expect(result.data.text).toBe('print("reproduce")\r\n')
  })

  it('refuses bytes that no longer match the digest the reproduction recorded', async () => {
    vi.mocked(api_findings.downloadCapture).mockResolvedValue({ bytes: original, mediaType: 'text/x-python', filename: 'exploit.py', digest: 'stale' })

    const result = await createRealFindingService().readArtifact(ctx, { captureId: 'cap-7', filename: 'exploit.py', mediaType: 'text/x-python', digest: '0'.repeat(64), sizeBytes: original.length, classification: 'standard', canReadOriginal: true })

    expect(result).toMatchObject({ ok: false, failure: { kind: 'conflict' } })
  })

  it('keeps a binary capture readable as bytes but gives it no text to copy', async () => {
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff])
    const digest = await sha256Hex(binary)
    vi.mocked(api_findings.downloadCapture).mockResolvedValue({ bytes: binary, mediaType: 'image/png', filename: 'shot.png', digest })

    const result = await createRealFindingService().readArtifact(ctx, { captureId: 'cap-8', filename: 'shot.png', mediaType: 'image/png', digest, sizeBytes: binary.length, classification: 'standard', canReadOriginal: true })

    if (!result.ok) throw new Error(result.failure.message)
    expect(result.data.bytes.length).toBe(binary.length)
    expect(result.data.text).toBeNull()
  })
})
