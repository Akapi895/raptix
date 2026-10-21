import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReproducePanel } from './reproduce'

const digest = 'a'.repeat(64)
const reproduction = {
  prerequisites: 'Authenticated operator session',
  inputs: 'Target base URL',
  steps: ['Log in as the reviewer', 'Run exploit.py against the target'],
  expectedObservation: 'The admin page renders without a session',
  limitations: 'Tested on version 1.2 only',
  artifact: { captureId: 'cap-7', filename: 'exploit.py', mediaType: 'text/x-python', digest, sizeBytes: 21, classification: 'standard' as const, canReadOriginal: true },
  verification: 'not_recorded' as const,
}
const original = new TextEncoder().encode('print("reproduce")\n')
const verified = { ok: true as const, data: { captureId: 'cap-7', filename: 'exploit.py', bytes: original, text: 'print("reproduce")\n' } }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ReproducePanel', () => {
  it('shows a finding without a recorded package as missing, with nothing to copy or download', () => {
    render(<ReproducePanel finding={{}} readArtifact={vi.fn()} />)

    expect(screen.getByText('No reproduction package recorded')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy text' })).toBeNull()
  })

  it('shows the recorded steps as unverified, with the digest of the artifact they name', () => {
    render(<ReproducePanel finding={{ reproduction }} readArtifact={vi.fn()} />)

    expect(screen.getByText('Not verified')).toBeInTheDocument()
    expect(screen.getByText('Run exploit.py against the target')).toBeInTheDocument()
    expect(screen.getByText(digest)).toBeInTheDocument()
  })

  it('keeps the producer source apart from the reproduction artifact', () => {
    render(<ReproducePanel finding={{ producer: { path: 'findings/FIND-004.md', digest: 'b'.repeat(64) } }} readArtifact={vi.fn()} />)

    expect(screen.getByText('Producer source')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy text' })).toBeNull()
  })

  it('copies the verified text of the linked capture', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    const readArtifact = vi.fn().mockResolvedValue(verified)
    render(<ReproducePanel finding={{ reproduction }} readArtifact={readArtifact} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('print("reproduce")\n'))
    expect(readArtifact).toHaveBeenCalledWith(reproduction.artifact)
  })

  it('refuses to copy a binary capture and points to the original download', async () => {
    const writeText = vi.fn()
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    const readArtifact = vi.fn().mockResolvedValue({ ok: true, data: { ...verified.data, text: null } })
    render(<ReproducePanel finding={{ reproduction }} readArtifact={readArtifact} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))

    expect(await screen.findByText(/not UTF-8 text/)).toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('downloads the original bytes under the recorded file name', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:artifact')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    const readArtifact = vi.fn().mockResolvedValue(verified)
    render(<ReproducePanel finding={{ reproduction }} readArtifact={readArtifact} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download original' }))

    await waitFor(() => expect(downloads).toEqual(['exploit.py']))
    expect(createObjectURL.mock.calls[0][0].size).toBe(original.length)
  })

  it('shows the failure the adapter reports and copies nothing', async () => {
    const writeText = vi.fn()
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    const readArtifact = vi.fn().mockResolvedValue({
      ok: false,
      failure: { kind: 'conflict', message: 'The retained capture no longer matches the digest recorded in this reproduction. Nothing was copied or downloaded.' },
    })
    render(<ReproducePanel finding={{ reproduction }} readArtifact={readArtifact} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))

    expect(await screen.findByText(/no longer matches the digest/)).toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('still copies the current artifact under StrictMode, which runs mount effects twice', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    const readArtifact = vi.fn().mockResolvedValue(verified)
    render(<StrictMode><ReproducePanel finding={{ reproduction }} readArtifact={readArtifact} /></StrictMode>)

    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('print("reproduce")\n'))
  })

  it('masks a restricted capture: no name, and no copy or download the role may not make', () => {
    const readArtifact = vi.fn()
    const restricted = { ...reproduction, artifact: { ...reproduction.artifact, filename: null, classification: 'sensitive' as const, canReadOriginal: false } }
    render(<ReproducePanel finding={{ reproduction: restricted }} readArtifact={readArtifact} />)

    expect(screen.getByText('Restricted capture')).toBeInTheDocument()
    expect(screen.queryByText('exploit.py')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy text' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download original' })).toBeDisabled()
    expect(screen.getByText('Your role cannot read the original bytes of this capture.')).toBeInTheDocument()
    expect(readArtifact).not.toHaveBeenCalled()
  })

  it('discards a copy that finishes after the linked artifact changed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    let finish!: (value: typeof verified) => void
    const readArtifact = vi.fn(() => new Promise<typeof verified>((resolve) => { finish = resolve }))
    const { rerender } = render(<ReproducePanel finding={{ reproduction }} readArtifact={readArtifact} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    const relinked = { ...reproduction, artifact: { ...reproduction.artifact, captureId: 'cap-9', filename: 'other.py', digest: 'b'.repeat(64) } }
    rerender(<ReproducePanel finding={{ reproduction: relinked }} readArtifact={readArtifact} />)
    finish(verified)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByText(/not UTF-8|clipboard is not available|no longer matches/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy text' })).toBeEnabled()
  })

  it('discards a copy that finishes after the read permission of the same capture changed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    let finish!: (value: typeof verified) => void
    const readArtifact = vi.fn(() => new Promise<typeof verified>((resolve) => { finish = resolve }))
    const { rerender } = render(<ReproducePanel finding={{ reproduction }} readArtifact={readArtifact} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    const reclassified = { ...reproduction, artifact: { ...reproduction.artifact, filename: null, classification: 'sensitive' as const, canReadOriginal: false } }
    rerender(<ReproducePanel finding={{ reproduction: reclassified }} readArtifact={readArtifact} />)
    finish(verified)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(writeText).not.toHaveBeenCalled()
    expect(screen.getByText('Restricted capture')).toBeInTheDocument()
  })

  it('discards a download that finishes after the read permission of the same capture changed', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:artifact')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    let finish!: (value: typeof verified) => void
    const readArtifact = vi.fn(() => new Promise<typeof verified>((resolve) => { finish = resolve }))
    const { rerender } = render(<ReproducePanel finding={{ reproduction }} readArtifact={readArtifact} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download original' }))
    const revoked = { ...reproduction, artifact: { ...reproduction.artifact, canReadOriginal: false } }
    rerender(<ReproducePanel finding={{ reproduction: revoked }} readArtifact={readArtifact} />)
    finish(verified)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(downloads).toEqual([])
  })
})
