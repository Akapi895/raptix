/**
 * The real-mode context: the trusted capabilities document and the identity the bootstrap read before any data
 * request. The composition root (shell/real-bootstrap.tsx) provides it; features read it through the hooks here, so no
 * feature imports the bootstrap or its login gate.
 */
import { createContext, useContext } from 'react'
import type { CapabilitiesDocument } from '@raptix/web-contracts'
import { capabilityState } from '../platform/capabilities'
import type { RealIdentity } from './real-identity'

export interface RealContextValue {
  readonly document: CapabilitiesDocument
  readonly identity: RealIdentity
}

export const RealContext = createContext<RealContextValue | null>(null)

/** Real-mode services; throws outside the real composition (fail-fast). */
export function useReal(): RealContextValue {
  const ctx = useContext(RealContext)
  if (!ctx) throw new Error('Real-mode context is not mounted (this surface cannot read real data).')
  return ctx
}

/**
 * Whether the same person may not decide their own workflow item (the four-eyes rule). Outside the real composition, and
 * on servers that do not advertise the rule, the rule applies: the control stays strict until the server says otherwise.
 */
export function useIndependentReviewRequired(): boolean {
  const ctx = useContext(RealContext)
  return ctx?.document.independentReview !== 'single-operator'
}

/** Whether a capability is usable right now (supported AND available). */
export function useCapabilityReady(name: string): { ready: boolean; reason: string | null } {
  const { document } = useReal()
  const capability = capabilityState(document, name)
  if (!capability || !capability.supported) return { ready: false, reason: 'This capability is not implemented on the connected server.' }
  if (!capability.available) {
    return { ready: false, reason: capability.reason ? `Unavailable: ${capability.reason.replace(/_/g, ' ')}.` : 'This capability is currently unavailable on the server.' }
  }
  return { ready: true, reason: null }
}
