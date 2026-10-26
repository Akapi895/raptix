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

const NONE = { agents: { running: 0, done: 0, failed: 0 }, toolCalls: { count: 0, truncated: false }, runningTool: null, objectives: null }

describe('ProgressCard', () => {
  it('counts ready planning documents and names the next one to finish', () => {
    render(<ProgressCard bundle={{ roe: 'ready', conops: 'missing' }} labels={{ roe: 'RoE', conops: 'CONOPS' }} progress={NONE} />)
    expect(screen.getByText('1/2 documents')).toBeTruthy()
    expect(screen.getByText('next')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')
  })

  it('reports agents by state, tool calls and the running call', () => {
    render(<ProgressCard bundle={null} labels={{}} progress={{ agents: { running: 1, done: 2, failed: 1 }, toolCalls: { count: 4, truncated: false }, runningTool: 'bash', objectives: null }} />)
    expect(screen.getByText('1 running')).toBeTruthy()
    expect(screen.getByText('2 done')).toBeTruthy()
    expect(screen.getByText('1 failed')).toBeTruthy()
    expect(screen.getByText(/4 tool calls/)).toBeTruthy()
    expect(screen.getByText('Running bash')).toBeTruthy()
  })

  it('says so when there is no planning data and no tool activity', () => {
    render(<ProgressCard bundle={null} labels={{}} progress={NONE} />)
    expect(screen.getByText(/No work has started on this thread yet/)).toBeTruthy()
  })
})
