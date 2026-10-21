/** Actor-scoped request identities for retryable finding comments and retests. */

export interface FindingRequestScope {
  deploymentId: string
  actorId: string
  engagementId: string
  findingId: string
  action: 'comment' | 'retest'
  payload: object
}

class FindingRecoveryError extends Error {
  public readonly cause: unknown

  constructor(cause: unknown) {
    super('Cannot persist the finding request identity. Enable browser storage before saving.')
    this.name = 'FindingRecoveryError'
    this.cause = cause
  }
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function storageKey(scope: FindingRequestScope): Promise<string> {
  const identity = JSON.stringify([scope.deploymentId, scope.actorId, scope.engagementId, scope.findingId, scope.action, scope.payload])
  return `raptix.real.finding-request.v1.${await digest(identity)}`
}

export async function findingRequestId(scope: FindingRequestScope): Promise<string> {
  const key = await storageKey(scope)
  try {
    const stored = window.localStorage.getItem(key)
    if (stored) return stored
    const requestId = crypto.randomUUID()
    window.localStorage.setItem(key, requestId)
    return requestId
  } catch (cause) {
    throw new FindingRecoveryError(cause)
  }
}

export async function clearFindingRequest(scope: FindingRequestScope): Promise<void> {
  try { window.localStorage.removeItem(await storageKey(scope)) }
  catch { /* Server-side request identity remains safe to replay. */ }
}
