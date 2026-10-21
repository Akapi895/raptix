import { isCapabilitiesDocument, type CapabilitiesDocument, type Capability } from '@raptix/web-contracts';
import { apiFetch } from './transport';

/** Fetches and validates the server's capability document. */
export function fetchCapabilities(): Promise<CapabilitiesDocument> {
  return apiFetch('/capabilities', isCapabilitiesDocument)
}

export function capabilityState(document: CapabilitiesDocument, name: string): Capability | null {
  return document.capabilities[name] ?? null
}
