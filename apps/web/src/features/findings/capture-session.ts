/** Actor- and engagement-scoped idempotency keys for retained capture uploads. */

function storageKey(deploymentId: string, actorId: string, engagementId: string, fingerprint: string): string {
  return `raptix.real.capture-request.v1.${JSON.stringify([deploymentId, actorId, engagementId, fingerprint])}`
}

export function captureRequestId(deploymentId: string, actorId: string, engagementId: string, fingerprint: string): string {
  const key = storageKey(deploymentId, actorId, engagementId, fingerprint)
  try {
    const existing = window.localStorage.getItem(key)
    if (existing) return existing
    const requestId = crypto.randomUUID()
    window.localStorage.setItem(key, requestId)
    return requestId
  } catch {
    return crypto.randomUUID()
  }
}

export function clearCaptureRequest(deploymentId: string, actorId: string, engagementId: string, fingerprint: string): void {
  try { window.localStorage.removeItem(storageKey(deploymentId, actorId, engagementId, fingerprint)) }
  catch { /* The completed request remains idempotent on the server. */ }
}
