import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ProgressCard, UpdatesGroup } from './workspace-progress'
import { isFoldableUpdate } from '../workspace-updates'

describe('isFoldableUpdate', () => {
  it('folds a short single-line assistant progress line', () => {
    expect(isFoldableUpdate({ role: 'assistant', content: 'CONOPS xong' })).toBe(true)
  })

  it('never folds a user message, a multi-line reply, a code block or a reply with reasoning', () => {
    expect(isFoldableUpdate({ role: 'user', content: 'ok' })).toBe(false)
    expect(isFoldableUpdate({ role: 'assistant', content: 'line one\nline two' })).toBe(false)
    expect(isFoldableUpdate({ role: 'assistant', content: 'see ```x```' })).toBe(false)
    expect(isFoldableUpdate({ role: 'assistant', content: 'done', reasoning: 'why' })).toBe(false)
  })

  it('does not fold a long reply', () => {
    expect(isFoldableUpdate({ role: 'assistant', content: 'x'.repeat(161) })).toBe(false)
  })
})

describe('UpdatesGroup', () => {
  it('shows the count and newest line, and reveals every line on request', async () => {
    render(<ul><UpdatesGroup texts={['RoE done', 'CONOPS done', 'Contact Plan done']} /></ul>)
    expect(screen.getByRole('button', { name: /3 updates/ }).textContent).toContain('Contact Plan done')
    expect(screen.queryByText('RoE done')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: /3 updates/ }))
    expect(screen.getByText('RoE done')).toBeTruthy()
    expect(screen.getByText('CONOPS done')).toBeTruthy()
  })
})

describe('ProgressCard', () => {
  it('counts ready planning documents and names the next one to finish', () => {
    render(<ProgressCard bundle={{ roe: 'ready', conops: 'missing' }} labels={{ roe: 'RoE', conops: 'CONOPS' }} tools={{ calls: 0, failed: 0, running: null }} />)
    expect(screen.getByText('1/2 documents')).toBeTruthy()
    expect(screen.getByText('next')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')
  })

  it('reports tool calls, failures and the running call', () => {
    render(<ProgressCard bundle={null} labels={{}} tools={{ calls: 4, failed: 1, running: 'tool call: bash' }} />)
    expect(screen.getByText(/4 tool calls/)).toBeTruthy()
    expect(screen.getByText(/1 failed/)).toBeTruthy()
    expect(screen.getByText('Running tool call: bash')).toBeTruthy()
  })

  it('says so when there is no planning data and no tool activity', () => {
    render(<ProgressCard bundle={null} labels={{}} tools={{ calls: 0, failed: 0, running: null }} />)
    expect(screen.getByText(/Nothing in progress yet/)).toBeTruthy()
  })
})
