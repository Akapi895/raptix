/**
 * Compatibility barrel (ticket 61d): the scenario launcher and workspace
 * selection live in `src/screens/demo/pages.tsx`. This barrel keeps the lazy
 * slice record's import path (`src/screens/scenarios`) resolving for the
 * router registry; contraction batch B (66) retires it with the other demo
 * wrappers.
 */
export { routes } from './demo/pages'
