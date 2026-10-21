import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FindingReproductionInput } from '@raptix/web-contracts'
import { ReproductionFields } from './reproduction-form'
import type { RetainedCaptureOption } from './service'

const linked = { captureId: 'cap-7', filename: 'exploit.py', mediaType: 'text/x-python', digest: 'a'.repeat(64), sizeBytes: 21, classification: 'standard' as const, canReadOriginal: true }
const draft: FindingReproductionInput = { prerequisites: '', inputs: '', steps: [], expectedObservation: '', limitations: '', artifact: { captureId: 'cap-7', digest: 'a'.repeat(64) } }
const listed: RetainedCaptureOption[] = [{ captureId: 'cap-9', filename: 'other.txt', mediaType: 'text/plain', digest: 'c'.repeat(64), sizeBytes: 9, classification: 'standard', canReadOriginal: true }]

afterEach(() => {
  cleanup()
})

describe('ReproductionFields capture picker', () => {
  it('keeps the linked capture visible, and the picker disabled, while the list is loading', () => {
    render(<ReproductionFields value={draft} onChange={vi.fn()} captures={[]} captureList={{ status: 'loading' }} linked={linked} onRetryCaptures={vi.fn()} />)

    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('combobox')).toHaveValue('cap-7')
    expect(screen.getByText(/Loading the project/)).toBeInTheDocument()
  })

  it('reports a failed list with its reason, keeps the selection, and retries the list', () => {
    const onRetry = vi.fn()
    render(<ReproductionFields value={draft} onChange={vi.fn()} captures={[]} captureList={{ status: 'error', message: 'Capture list unavailable.' }} linked={linked} onRetryCaptures={onRetry} />)

    expect(screen.getByText(/Capture list unavailable\./)).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('cap-7')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('still names the linked capture when the ready list does not contain it', () => {
    render(<ReproductionFields value={draft} onChange={vi.fn()} captures={listed} captureList={{ status: 'ready' }} linked={linked} onRetryCaptures={vi.fn()} />)

    expect(screen.getByRole('combobox')).toHaveValue('cap-7')
    expect(screen.getByRole('option', { name: /exploit\.py/ })).toBeInTheDocument()
  })
})
