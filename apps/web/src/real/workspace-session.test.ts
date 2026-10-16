/** O03: actor-scoped recovery storage — isolation, deliberate legacy drop, logout wipe. */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPending, clearWorkspaceRecovery, readPending, readSelection,
  savePending, saveSelection, type PendingRequest, type SelectedThread,
} from './workspace-session'

const PENDING = (requestId: string): PendingRequest => ({ requestId, threadId: null, kind: 'planning' })
const SELECTED: SelectedThread = { threadId: 'thread-1', kind: 'execution' }

beforeEach(() => { localStorage.clear() })

describe('actor-scoped recovery storage', () => {
  it('never restores recovery from another deployment with overlapping actor and resource IDs', () => {
    savePending('local', 'eng-1', PENDING('req-a'), 'deployment-a')
    expect(readPending('local', 'eng-1', 'deployment-b')).toBeNull()
    expect(readPending('local', 'eng-1', 'deployment-a')?.requestId).toBe('req-a')
  })
  it('keeps two actors sharing a browser from reading each other recovery state', () => {
    saveSelection('actor-a', 'eng-1', SELECTED)
    savePending('actor-a', 'eng-1', PENDING('req-a'))
    savePending('actor-b', 'eng-1', PENDING('req-b'))

    expect(readSelection('actor-a', 'eng-1')).toEqual(SELECTED)
    expect(readSelection('actor-b', 'eng-1')).toBeNull()
    expect(readPending('actor-a', 'eng-1')?.requestId).toBe('req-a')
    expect(readPending('actor-b', 'eng-1')?.requestId).toBe('req-b')
    clearPending('actor-a', 'eng-1', 'req-a')
    expect(readPending('actor-a', 'eng-1')).toBeNull()
    expect(readPending('actor-b', 'eng-1')?.requestId).toBe('req-b')
  })

  it('drops the pre-actor legacy keys instead of migrating them', () => {
    localStorage.setItem('raptix.real.local.eng-1.thread', JSON.stringify({ threadId: 'legacy-thread', kind: 'planning' }))
    localStorage.setItem('raptix.real.local.eng-1.request', JSON.stringify({ requestId: 'legacy-req', threadId: null, kind: 'planning' }))
    expect(readSelection('actor-a', 'eng-1')).toBeNull()
    expect(readPending('actor-a', 'eng-1')).toBeNull()
    saveSelection('actor-a', 'eng-1', SELECTED)
    expect(localStorage.getItem('raptix.real.local.eng-1.thread')).toBeNull()
    expect(localStorage.getItem('raptix.real.local.eng-1.request')).toBeNull()
    expect(readSelection('actor-a', 'eng-1')).toEqual(SELECTED)
  })

  it('ignores malformed or mistyped entries instead of restoring them', () => {
    savePending('actor-a', 'eng-1', PENDING('req-1'))
    localStorage.setItem(Object.keys(localStorage).find(key => key.startsWith('raptix.real.pending.v2.'))!, '{broken')
    expect(readPending('actor-a', 'eng-1')).toBeNull()
    saveSelection('actor-a', 'eng-1', SELECTED)
    localStorage.setItem(Object.keys(localStorage).find(key => key.startsWith('raptix.real.selection.v2.'))!, JSON.stringify({ threadId: 7, kind: 'planning' }))
    expect(readSelection('actor-a', 'eng-1')).toBeNull()
  })

  it('clearWorkspaceRecovery removes every real-mode entry for logout/expiry', () => {
    saveSelection('actor-a', 'eng-1', SELECTED)
    savePending('actor-a', 'eng-1', PENDING('req-a'))
    savePending('actor-b', 'eng-2', PENDING('req-b'))
    localStorage.setItem('raptix.real.draft.v1.["actor-a","eng-1","thread-1"]', 'unsent plaintext')
    localStorage.setItem('raptix.real.local.eng-1.thread', JSON.stringify({ threadId: 'legacy', kind: 'planning' }))
    localStorage.setItem('raptix.real.execution.agents.width', '520')
    localStorage.setItem('unrelated.key', 'keep me')
    clearWorkspaceRecovery()
    expect(readSelection('actor-a', 'eng-1')).toBeNull()
    expect(readPending('actor-a', 'eng-1')).toBeNull()
    expect(readPending('actor-b', 'eng-2')).toBeNull()
    expect(localStorage.getItem('raptix.real.draft.v1.["actor-a","eng-1","thread-1"]')).toBeNull()
    expect(localStorage.getItem('raptix.real.local.eng-1.thread')).toBeNull()
    expect(localStorage.getItem('unrelated.key')).toBe('keep me')
    // A panel-size preference is not recovery state and must survive the wipe.
    expect(localStorage.getItem('raptix.real.execution.agents.width')).toBe('520')
  })
})
