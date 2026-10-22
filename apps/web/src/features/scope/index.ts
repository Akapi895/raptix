/**
 * Public surface of the scope feature (ADR-0096). Callers import from here; the feature's files stay private.
 */
export { ScopeError, useScopeRead, useScopeWrites } from './query'
