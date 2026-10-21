import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearFindingRequest, findingRequestId, type FindingRequestScope } from './finding-session'

const scope: FindingRequestScope = {
  deploymentId: 'local', actorId: 'operator-1', engagementId: 'eng-1', findingId: 'finding-1',
  action: 'comment', payload: { text: 'Impact evidence added.' },
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('finding request identities', () => {
  it('reuses an unacknowledged request for the same actor, finding and payload', async () => {
    const first = await findingRequestId(scope)
    expect(await findingRequestId(scope)).toBe(first)
    expect(await findingRequestId({ ...scope, payload: { text: 'Different comment.' } })).not.toBe(first)
  })

  it('separates actors and actions and clears the key after acknowledgement', async () => {
    const first = await findingRequestId(scope)
    expect(await findingRequestId({ ...scope, actorId: 'operator-2' })).not.toBe(first)
    expect(await findingRequestId({ ...scope, action: 'retest' })).not.toBe(first)
    await clearFindingRequest(scope)
    expect(await findingRequestId(scope)).not.toBe(first)
  })

  it('refuses a new write when the retry identity cannot be persisted', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled.') })
    await expect(findingRequestId(scope)).rejects.toThrow('persist')
  })

  it('keeps a newer pending payload when an older acknowledgement arrives', async () => {
    await findingRequestId(scope)
    const newer = { ...scope, payload: { text: 'A newer comment.' } }
    const newRequest = await findingRequestId(newer)
    await clearFindingRequest(scope)
    expect(await findingRequestId(newer)).toBe(newRequest)
  })
})
