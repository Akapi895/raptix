import { isRealMode } from '../state/mode'

/**
 * The organization the shell names. Demo data belongs to "Acme Security (Demo)"; a real deployment has no organization
 * record yet, so it names the local workspace instead of borrowing the demo name (checklist G-07).
 */
export const organizationLabel = (): string => (isRealMode() ? 'Local workspace' : 'Acme Security (Demo)')
