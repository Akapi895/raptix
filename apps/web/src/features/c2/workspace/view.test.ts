import { describe, expect, it } from 'vitest'
import { c2WorkspaceView } from './view'

describe('c2WorkspaceView', () => {
  it('opens the sessions view for the legacy address and for a detail address without its id', () => {
    expect(c2WorkspaceView({ page: 'c2' })).toEqual({ kind: 'sessions' })
    expect(c2WorkspaceView({ page: 'c2-session' })).toEqual({ kind: 'sessions' })
    expect(c2WorkspaceView({ page: 'c2-channel' })).toEqual({ kind: 'sessions' })
  })

  it('keeps the id of a session and of a channel', () => {
    expect(c2WorkspaceView({ page: 'c2-session', id: 'sess-1' })).toEqual({ kind: 'session', sessionId: 'sess-1' })
    expect(c2WorkspaceView({ page: 'c2-channel', id: 'tcp-443' })).toEqual({ kind: 'channel', transport: 'tcp-443' })
  })

  it('resolves the console address to the console view, with or without a session', () => {
    expect(c2WorkspaceView({ page: 'c2-console', id: 'sess-1' })).toEqual({ kind: 'console', sessionId: 'sess-1' })
    expect(c2WorkspaceView({ page: 'c2-console' })).toEqual({ kind: 'console', sessionId: null })
  })

  it('leaves any other page to the sessions view', () => {
    expect(c2WorkspaceView({ page: 'operations', id: 'OP-1' })).toEqual({ kind: 'sessions' })
  })
})
