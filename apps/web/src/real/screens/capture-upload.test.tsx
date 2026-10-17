import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CaptureUpload } from './capture-upload'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('routes the legacy producer panel to the shared Evidence workflow', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  render(<CaptureUpload engagementId="eng-1" />)
  expect(screen.getByRole('status')).toHaveTextContent(/shared Evidence workflow/i)
  expect(screen.getByRole('button', { name: 'Open Evidence inventory' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /upload capture/i })).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/retain capture/i)).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})
