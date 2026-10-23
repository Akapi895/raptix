/**
 * Prototype and QA pages: the demo hub (`scenarios`), the state gallery (`states`) and the workspace picker prototype
 * (`workspaces`). They are registered only in the development server or in a build that opts in with
 * `VITE_PROTOTYPE_PAGES=true`. When off, the keys are absent from the route declaration, so the addresses resolve as
 * unknown routes, the same way the Asset Map flag works.
 *
 * This is a build-time gate. Mode (mock or real) is a separate choice and does not change it.
 */
export const PROTOTYPE_PAGES_ENABLED: boolean = import.meta.env.DEV || import.meta.env.VITE_PROTOTYPE_PAGES === 'true'
