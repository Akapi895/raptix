/**
 * Compatibility barrel (ticket 61c): the guided walkthrough's semantic module
 * lives in `src/screens/demo/` (guides.ts + launch.ts + guide.tsx). This
 * barrel keeps the shell slot default and the scenarios slice imports
 * resolving unchanged; contraction batch B (66) retires it with the other
 * demo wrappers.
 */
export { DemoGuide } from './demo/guide'
export { jump, launchGuide, stopGuide } from './demo/launch'
export { GUIDES, type DemoKit, type Dest, type GStep, type Guide } from './demo/guides'
